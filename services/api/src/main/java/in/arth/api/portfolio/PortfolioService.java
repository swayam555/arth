package in.arth.api.portfolio;

import in.arth.api.common.Events;
import in.arth.api.common.Hashing;
import in.arth.api.common.Problems;
import in.arth.api.market.QuoteCache;
import in.arth.api.portfolio.ImportReport.Draft;
import in.arth.api.portfolio.ImportReport.Issue;
import in.arth.api.portfolio.PortfolioModels.Allocation;
import in.arth.api.portfolio.PortfolioModels.History;
import in.arth.api.portfolio.PortfolioModels.Holding;
import in.arth.api.portfolio.PortfolioModels.Point;
import in.arth.api.portfolio.PortfolioModels.Slice;
import in.arth.api.portfolio.PortfolioModels.Summary;
import in.arth.proto.v1.PortfolioUpdated;
import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.nio.charset.StandardCharsets;
import java.sql.Date;
import java.time.Clock;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.HashMap;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.TreeMap;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.TransactionTemplate;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

@Service
public class PortfolioService {

	public static final ZoneId IST = ZoneId.of("Asia/Kolkata");
	public static final int MAX_TXNS = 20_000;

	public record TxnInput(String symbol, Txn.Side side, BigDecimal qty, BigDecimal price, LocalDate tradeDate) {}

	record Meta(String symbol, String isin, String name, String sector, String mcap, String asset, BigDecimal prevClose) {}

	private final JdbcClient jdbc;
	private final QuoteCache quotes;
	private final Events events;
	private final Clock clock;
	private final TransactionTemplate tx;

	PortfolioService(JdbcClient jdbc, QuoteCache quotes, Events events, Optional<Clock> clock, PlatformTransactionManager txm) {
		this.jdbc = jdbc;
		this.tx = new TransactionTemplate(txm);
		this.quotes = quotes;
		this.events = events;
		this.clock = clock.orElse(Clock.system(IST));
	}

	LocalDate today() {
		return LocalDate.now(clock.withZone(IST));
	}

	public List<Txn> transactions(UUID userId) {
		return jdbc.sql("""
				SELECT id, symbol, side, qty, price, trade_date, source FROM portfolio_txns
				WHERE user_id = ? ORDER BY trade_date DESC, created_at DESC""")
				.param(userId)
				.query((rs, n) -> new Txn(rs.getObject("id", UUID.class), rs.getString("symbol"), Txn.Side.valueOf(rs.getString("side")),
						rs.getBigDecimal("qty").stripTrailingZeros(), rs.getBigDecimal("price"), rs.getObject("trade_date", LocalDate.class),
						rs.getString("source")))
				.list();
	}

	public long version(UUID userId) {
		return jdbc.sql("SELECT version FROM portfolio_versions WHERE user_id = ?").param(userId).query(Long.class).optional().orElse(0L);
	}

	@Transactional
	public Txn add(UUID userId, TxnInput in) {
		lock(userId);
		validate(in);
		List<Txn> txns = new ArrayList<>(transactions(userId));
		if (txns.size() >= MAX_TXNS) {
			throw Problems.conflict("txn_limit", "At most " + MAX_TXNS + " transactions");
		}
		Txn created = new Txn(UUID.randomUUID(), in.symbol(), in.side(), in.qty(), in.price(), in.tradeDate(), "manual");
		txns.add(created);
		checkLedger(txns);
		insert(userId, List.of(created), null);
		bump(userId);
		return created;
	}

	@Transactional
	public Txn update(UUID userId, UUID id, TxnInput in) {
		lock(userId);
		validate(in);
		List<Txn> txns = new ArrayList<>(transactions(userId));
		Txn old = txns.stream().filter(t -> t.id().equals(id)).findFirst().orElseThrow(() -> Problems.notFound("Transaction"));
		Txn updated = new Txn(id, in.symbol(), in.side(), in.qty(), in.price(), in.tradeDate(), old.source());
		txns.replaceAll(t -> t.id().equals(id) ? updated : t);
		checkLedger(txns);
		jdbc.sql("UPDATE portfolio_txns SET symbol = ?, side = ?, qty = ?, price = ?, trade_date = ? WHERE id = ? AND user_id = ?")
				.params(in.symbol(), in.side().name(), in.qty(), in.price(), in.tradeDate(), id, userId)
				.update();
		bump(userId);
		return updated;
	}

	@Transactional
	public void delete(UUID userId, UUID id) {
		lock(userId);
		List<Txn> txns = new ArrayList<>(transactions(userId));
		if (!txns.removeIf(t -> t.id().equals(id))) {
			throw Problems.notFound("Transaction");
		}
		checkLedger(txns);
		jdbc.sql("DELETE FROM portfolio_txns WHERE id = ? AND user_id = ?").params(id, userId).update();
		bump(userId);
	}

	public Summary summary(UUID userId) {
		List<Txn> txns = transactions(userId);
		Map<String, Ledger.Position> positions = Ledger.replay(txns);
		Map<String, Meta> meta = meta(positions.keySet());
		List<Holding> holdings = new ArrayList<>();
		BigDecimal invested = BigDecimal.ZERO;
		BigDecimal value = BigDecimal.ZERO;
		BigDecimal day = BigDecimal.ZERO;
		BigDecimal realized = BigDecimal.ZERO;
		for (Ledger.Position p : positions.values()) {
			realized = realized.add(p.realized());
			if (p.qty().signum() == 0) {
				continue;
			}
			Meta m = meta.get(p.symbol());
			Optional<QuoteCache.Quote> q = quotes.get(p.symbol()).filter(x -> x.ltp().signum() > 0);
			BigDecimal ltp = q.map(QuoteCache.Quote::ltp).orElse(m.prevClose());
			BigDecimal prev = q.map(QuoteCache.Quote::prevClose).filter(x -> x.signum() > 0).orElse(m.prevClose());
			BigDecimal val = ltp.multiply(p.qty());
			BigDecimal dayChange = ltp.subtract(prev).multiply(p.qty());
			BigDecimal pnl = val.subtract(p.cost());
			holdings.add(new Holding(p.symbol(), m.name(), m.sector(), m.mcap(), m.asset(), p.qty().stripTrailingZeros(), money(p.avgCost()),
					money(p.cost()), ltp, prev, money(val), money(dayChange), pct(ltp.subtract(prev), prev), money(pnl), pct(pnl, p.cost()), 0,
					q.isPresent()));
			invested = invested.add(p.cost());
			value = value.add(val);
			day = day.add(dayChange);
		}
		BigDecimal total = value;
		holdings.replaceAll(h -> withWeight(h, ratio(h.value(), total)));
		holdings.sort(Comparator.comparing(Holding::value).reversed());
		Allocation allocation = new Allocation(slices(holdings, Holding::sector, total), slices(holdings, Holding::mcapBucket, total),
				slices(holdings, Holding::assetClass, total));
		List<Holding> byDay = holdings.stream().sorted(Comparator.comparingDouble(Holding::dayChangePct).reversed()).toList();
		List<Holding> gainers = byDay.stream().filter(h -> h.dayChangePct() > 0).limit(3).toList();
		List<Holding> losers = byDay.reversed().stream().filter(h -> h.dayChangePct() < 0).limit(3).toList();
		Double xirr = xirr(txns, total);
		return new Summary(version(userId), money(invested), money(value), money(day), pct(day, value.subtract(day)), money(value.subtract(invested)),
				pct(value.subtract(invested), invested), money(realized), xirr, holdings, allocation, gainers, losers, txns.size());
	}

	Double xirr(List<Txn> txns, BigDecimal terminal) {
		List<Xirr.Flow> flows = new ArrayList<>();
		txns.stream().sorted(Ledger.ORDER).forEach(t -> {
			double amt = t.qty().multiply(t.price()).doubleValue();
			flows.add(new Xirr.Flow(t.tradeDate(), t.side() == Txn.Side.BUY ? -amt : amt));
		});
		if (terminal.signum() > 0) {
			flows.add(new Xirr.Flow(today(), terminal.doubleValue()));
		}
		if (flows.isEmpty() || !flows.getLast().date().isAfter(flows.getFirst().date())) {
			return null;
		}
		var r = Xirr.compute(flows);
		return r.isPresent() ? Math.round(r.getAsDouble() * 1e6) / 1e6 : null;
	}

	/** Daily portfolio value from daily closes, carried forward over non-trading days; a trade price stands in before the first close. */
	public History history(UUID userId, int days) {
		List<Txn> txns = transactions(userId).stream().sorted(Ledger.ORDER).toList();
		LocalDate end = today();
		LocalDate start = end.minusDays(days - 1L);
		if (txns.isEmpty()) {
			return new History(List.of(), 0);
		}
		if (txns.getFirst().tradeDate().isAfter(start)) {
			start = txns.getFirst().tradeDate();
		}
		List<String> symbols = txns.stream().map(Txn::symbol).distinct().toList();
		Map<String, TreeMap<LocalDate, BigDecimal>> closes = new HashMap<>();
		jdbc.sql("""
				SELECT symbol, (bucket AT TIME ZONE 'Asia/Kolkata')::date AS d, c FROM candles_1d
				WHERE symbol = ANY(?) AND bucket >= ? AND bucket < ?""")
				.params(symbols.toArray(String[]::new), Date.valueOf(start.minusDays(10)), Date.valueOf(end.plusDays(1)))
				.query(rs -> {
					closes.computeIfAbsent(rs.getString("symbol"), k -> new TreeMap<>()).put(rs.getObject("d", LocalDate.class), rs.getBigDecimal("c"));
				});
		Map<String, BigDecimal> lastTradePrice = new HashMap<>();
		Map<String, BigDecimal> live = new HashMap<>();
		Map<String, Meta> meta = meta(symbols);
		List<Point> points = new ArrayList<>();
		int priced = 0;
		int estimated = 0;
		int idx = 0;
		Map<String, Ledger.Position> pos = Map.of();
		List<Txn> seen = new ArrayList<>();
		for (LocalDate d = start; !d.isAfter(end); d = d.plusDays(1)) {
			boolean changed = false;
			while (idx < txns.size() && !txns.get(idx).tradeDate().isAfter(d)) {
				Txn t = txns.get(idx++);
				seen.add(t);
				lastTradePrice.put(t.symbol(), t.price());
				changed = true;
			}
			if (changed) {
				pos = Ledger.replay(seen);
			}
			BigDecimal value = BigDecimal.ZERO;
			BigDecimal invested = BigDecimal.ZERO;
			for (Ledger.Position p : pos.values()) {
				if (p.qty().signum() == 0) {
					continue;
				}
				BigDecimal px = null;
				if (d.equals(end)) {
					px = live.computeIfAbsent(p.symbol(), s -> quotes.get(s).map(QuoteCache.Quote::ltp).filter(x -> x.signum() > 0)
							.orElseGet(() -> meta.containsKey(s) ? meta.get(s).prevClose() : null));
				}
				if (px == null) {
					var c = closes.getOrDefault(p.symbol(), new TreeMap<>()).floorEntry(d);
					px = c == null ? null : c.getValue();
				}
				priced++;
				if (px == null) {
					px = lastTradePrice.get(p.symbol());
					estimated++;
				}
				value = value.add(px.multiply(p.qty()));
				invested = invested.add(p.cost());
			}
			points.add(new Point(d, money(value), money(invested)));
		}
		return new History(points, priced == 0 ? 0 : Math.round(1000.0 * estimated / priced) / 1000.0);
	}

	// ---- imports ----

	public ImportReport importCsv(UUID userId, byte[] file, Map<String, String> mapping, boolean dryRun) {
		Lookup lookup = lookup();
		CsvImport.Result r = CsvImport.read(new String(file, StandardCharsets.UTF_8), mapping, lookup::resolve, today());
		return finish(userId, file, "csv", null, null, null, null, r.headers(), r.mapping(), r.drafts(), r.issues(), new ArrayList<>(), dryRun);
	}

	public ImportReport importCas(UUID userId, byte[] file, String password, boolean dryRun) {
		Lookup lookup = lookup();
		CasParser.Result r;
		try {
			r = CasParser.read(file, password, lookup::byIsin);
		} catch (CasParser.CasException e) {
			throw Problems.badRequest(e.code, e.getMessage());
		}
		return finish(userId, file, "cas", r.provider(), r.statementDate(), r.pan(), r.email(), List.of(), Map.of(), r.drafts(), r.issues(),
				new ArrayList<>(r.warnings()), dryRun);
	}

	private ImportReport finish(UUID userId, byte[] file, String kind, String provider, LocalDate statementDate, String pan, String email,
			List<String> headers, Map<String, String> mapping, List<Draft> drafts, List<Issue> issues, List<String> warnings, boolean dryRun) {
		String sha = HexFormat.of().formatHex(Hashing.sha256(file));
		boolean duplicate = jdbc.sql("SELECT 1 FROM portfolio_imports WHERE user_id = ? AND file_sha256 = ?").params(userId, sha).query().listOfRows().size() > 0;
		if (duplicate) {
			if (!dryRun) {
				throw Problems.conflict("duplicate_import", "This file was already imported");
			}
			warnings.add("This exact file was already imported; committing it again is blocked");
		}
		List<Issue> rejected = new ArrayList<>(issues);
		List<Txn> combined = new ArrayList<>(transactions(userId));
		drafts.forEach(d -> combined.add(new Txn(UUID.randomUUID(), d.symbol(), d.side(), d.qty(), d.price(), d.tradeDate(), kind)));
		boolean oversell = false;
		try {
			Ledger.replay(combined);
		} catch (Ledger.OversellException e) {
			oversell = true;
			rejected.add(new Issue(0, "qty", e.getMessage() + ". Import the earlier buys first or fix the quantities."));
		}
		UUID importId = null;
		boolean commit = !dryRun && !oversell && !drafts.isEmpty();
		if (!dryRun && oversell) {
			throw Problems.badRequest("oversell", rejected.getLast().message());
		}
		if (commit) {
			int failed = rejected.size();
			importId = tx.execute(status -> commit(userId, kind, provider, sha, drafts, failed));
		}
		return new ImportReport(kind, provider, statementDate, pan, email, headers, mapping, drafts.size(), rejected,
				drafts.stream().limit(50).toList(), warnings, commit, importId);
	}

	private UUID commit(UUID userId, String kind, String provider, String sha, List<Draft> drafts, int failed) {
		lock(userId);
		int existing = jdbc.sql("SELECT count(*) FROM portfolio_txns WHERE user_id = ?").param(userId).query(Integer.class).single();
		if (existing + drafts.size() > MAX_TXNS) {
			throw Problems.conflict("txn_limit", "At most " + MAX_TXNS + " transactions");
		}
		UUID importId = jdbc.sql("""
				INSERT INTO portfolio_imports (user_id, kind, provider, file_sha256, rows_ok, rows_failed) VALUES (?, ?, ?, ?, ?, ?)
				ON CONFLICT (user_id, file_sha256) DO NOTHING RETURNING id""")
				.params(userId, kind, provider, sha, drafts.size(), failed)
				.query(UUID.class)
				.optional()
				.orElseThrow(() -> Problems.conflict("duplicate_import", "This file was already imported"));
		insert(userId, drafts.stream().map(d -> new Txn(UUID.randomUUID(), d.symbol(), d.side(), d.qty(), d.price(), d.tradeDate(), kind)).toList(),
				importId);
		checkLedger(transactions(userId));
		bump(userId);
		return importId;
	}

	// ---- helpers ----

	record Lookup(Map<String, String> symbols, Map<String, String> isins) {
		Optional<String> resolve(String key) {
			return Optional.ofNullable(symbols.get(key)).or(() -> byIsin(key));
		}

		Optional<String> byIsin(String isin) {
			return Optional.ofNullable(isins.get(isin));
		}
	}

	private Lookup lookup() {
		Map<String, String> symbols = new HashMap<>();
		Map<String, String> isins = new HashMap<>();
		jdbc.sql("SELECT symbol, isin FROM instruments").query(rs -> {
			symbols.put(rs.getString(1), rs.getString(1));
			isins.put(rs.getString(2), rs.getString(1));
		});
		return new Lookup(symbols, isins);
	}

	private Map<String, Meta> meta(java.util.Collection<String> symbols) {
		if (symbols.isEmpty()) {
			return Map.of();
		}
		return jdbc.sql("SELECT symbol, isin, name, sector, mcap_bucket, asset_class, prev_close FROM instruments WHERE symbol = ANY(?)")
				.param(symbols.toArray(String[]::new))
				.query((rs, n) -> new Meta(rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4), rs.getString(5), rs.getString(6),
						rs.getBigDecimal(7)))
				.list()
				.stream()
				.collect(Collectors.toMap(Meta::symbol, Function.identity()));
	}

	private void validate(TxnInput in) {
		if (jdbc.sql("SELECT 1 FROM instruments WHERE symbol = ?").param(in.symbol()).query().listOfRows().isEmpty()) {
			throw Problems.badRequest("unknown_symbol", "Unknown symbol " + in.symbol());
		}
		if (in.tradeDate().isAfter(today())) {
			throw Problems.badRequest("future_date", "Trade date is in the future");
		}
	}

	private static void checkLedger(List<Txn> txns) {
		try {
			Ledger.replay(txns);
		} catch (Ledger.OversellException e) {
			throw Problems.badRequest("oversell", e.getMessage());
		}
	}

	private void lock(UUID userId) {
		jdbc.sql("SELECT id FROM users WHERE id = ? FOR UPDATE").param(userId).query().listOfRows();
	}

	private void insert(UUID userId, List<Txn> txns, UUID importId) {
		for (Txn t : txns) {
			jdbc.sql("INSERT INTO portfolio_txns (id, user_id, symbol, side, qty, price, trade_date, source, import_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)")
					.params(t.id(), userId, t.symbol(), t.side().name(), t.qty(), t.price(), t.tradeDate(), t.source(), importId)
					.update();
		}
	}

	private void bump(UUID userId) {
		long version = jdbc.sql("""
				INSERT INTO portfolio_versions (user_id, version) VALUES (?, 1)
				ON CONFLICT (user_id) DO UPDATE SET version = portfolio_versions.version + 1, updated_at = now() RETURNING version""")
				.param(userId)
				.query(Long.class)
				.single();
		PortfolioUpdated event = PortfolioUpdated.newBuilder().setUserId(userId.toString()).setVersion(version).setTsMs(clock.millis()).build();
		if (TransactionSynchronizationManager.isSynchronizationActive()) {
			TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
				@Override
				public void afterCommit() {
					events.publish(Events.PORTFOLIO_UPDATED, userId.toString(), event);
				}
			});
		} else {
			events.publish(Events.PORTFOLIO_UPDATED, userId.toString(), event);
		}
	}

	private static List<Slice> slices(List<Holding> holdings, Function<Holding, String> key, BigDecimal total) {
		Map<String, BigDecimal> sums = new LinkedHashMap<>();
		holdings.forEach(h -> sums.merge(key.apply(h), h.value(), BigDecimal::add));
		return sums.entrySet().stream()
				.map(e -> new Slice(e.getKey(), money(e.getValue()), ratio(e.getValue(), total)))
				.sorted(Comparator.comparing(Slice::value).reversed())
				.toList();
	}

	private static Holding withWeight(Holding h, double w) {
		return new Holding(h.symbol(), h.name(), h.sector(), h.mcapBucket(), h.assetClass(), h.qty(), h.avgCost(), h.invested(), h.ltp(), h.prevClose(),
				h.value(), h.dayChange(), h.dayChangePct(), h.pnl(), h.pnlPct(), w, h.live());
	}

	static BigDecimal money(BigDecimal v) {
		return v.setScale(2, RoundingMode.HALF_EVEN);
	}

	static double ratio(BigDecimal part, BigDecimal whole) {
		return whole.signum() == 0 ? 0 : part.divide(whole, MathContext.DECIMAL64).setScale(6, RoundingMode.HALF_EVEN).doubleValue();
	}

	static double pct(BigDecimal part, BigDecimal whole) {
		return whole.signum() == 0 ? 0 : part.multiply(BigDecimal.valueOf(100)).divide(whole, MathContext.DECIMAL64).setScale(4, RoundingMode.HALF_EVEN).doubleValue();
	}
}
