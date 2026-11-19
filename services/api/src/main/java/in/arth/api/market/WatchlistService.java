package in.arth.api.market;

import in.arth.api.common.Problems;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class WatchlistService {

	public static final int MAX_ITEMS = 200;
	public static final int MAX_LISTS = 10;
	static final List<String> DEFAULT_SYMBOLS = List.of("RELIANCE", "HDFCBANK", "TCS", "INFY", "ICICIBANK", "SBIN",
			"BHARTIARTL", "ITC", "LT", "TATAMOTORS", "ZOMATO", "NIFTYBEES");

	public record Item(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String symbol,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal prevClose,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal tickSize) {}

	public record Watchlist(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) int position,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Item> items) {}

	private final JdbcClient jdbc;
	private final InstrumentRepository instruments;

	WatchlistService(JdbcClient jdbc, InstrumentRepository instruments) {
		this.jdbc = jdbc;
		this.instruments = instruments;
	}

	@Transactional
	public void createDefault(UUID userId) {
		UUID id = insert(userId, "My Watchlist");
		replaceItems(userId, id, DEFAULT_SYMBOLS);
	}

	public List<Watchlist> list(UUID userId) {
		record Row(UUID id, String name, int position) {}
		List<Row> lists = jdbc.sql("SELECT id, name, position FROM watchlists WHERE user_id = ? ORDER BY position, created_at")
				.param(userId)
				.query((rs, n) -> new Row(rs.getObject("id", UUID.class), rs.getString("name"), rs.getInt("position")))
				.list();
		Map<UUID, List<Item>> items = new LinkedHashMap<>();
		lists.forEach(l -> items.put(l.id(), new ArrayList<>()));
		jdbc.sql("""
				SELECT wi.watchlist_id, i.symbol, i.name, i.prev_close, i.tick_size
				FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id JOIN instruments i ON i.symbol = wi.symbol
				WHERE w.user_id = ? ORDER BY wi.watchlist_id, wi.position""")
				.param(userId)
				.query(rs -> {
					items.get(rs.getObject("watchlist_id", UUID.class)).add(
							new Item(rs.getString("symbol"), rs.getString("name"), rs.getBigDecimal("prev_close"), rs.getBigDecimal("tick_size")));
				});
		return lists.stream().map(l -> new Watchlist(l.id(), l.name(), l.position(), items.get(l.id()))).toList();
	}

	public Watchlist get(UUID userId, UUID id) {
		return list(userId).stream().filter(w -> w.id().equals(id)).findFirst().orElseThrow(() -> Problems.notFound("Watchlist"));
	}

	@Transactional
	public Watchlist create(UUID userId, String name) {
		jdbc.sql("SELECT id FROM users WHERE id = ? FOR UPDATE").param(userId).query().listOfRows();
		int count = jdbc.sql("SELECT count(*) FROM watchlists WHERE user_id = ?").param(userId).query(Integer.class).single();
		if (count >= MAX_LISTS) {
			throw Problems.conflict("watchlist_limit", "At most " + MAX_LISTS + " watchlists");
		}
		return get(userId, insert(userId, name));
	}

	public Watchlist rename(UUID userId, UUID id, String name) {
		int n = jdbc.sql("UPDATE watchlists SET name = ? WHERE id = ? AND user_id = ?").params(name, id, userId).update();
		if (n == 0) {
			throw Problems.notFound("Watchlist");
		}
		return get(userId, id);
	}

	public void delete(UUID userId, UUID id) {
		int n = jdbc.sql("DELETE FROM watchlists WHERE id = ? AND user_id = ?").params(id, userId).update();
		if (n == 0) {
			throw Problems.notFound("Watchlist");
		}
	}

	@Transactional
	public Watchlist replaceItems(UUID userId, UUID id, List<String> symbols) {
		List<String> ordered = new ArrayList<>(new LinkedHashSet<>(symbols.stream().map(String::toUpperCase).toList()));
		if (ordered.size() > MAX_ITEMS) {
			throw Problems.badRequest("watchlist_full", "A watchlist holds at most " + MAX_ITEMS + " instruments");
		}
		List<String> unknown = instruments.missing(ordered);
		if (!unknown.isEmpty()) {
			throw Problems.badRequest("unknown_symbols", "Unknown symbols: " + String.join(", ", unknown));
		}
		boolean owned = jdbc.sql("SELECT 1 FROM watchlists WHERE id = ? AND user_id = ? FOR UPDATE").params(id, userId).query().listOfRows().size() == 1;
		if (!owned) {
			throw Problems.notFound("Watchlist");
		}
		jdbc.sql("DELETE FROM watchlist_items WHERE watchlist_id = ?").param(id).update();
		if (!ordered.isEmpty()) {
			jdbc.sql("""
					INSERT INTO watchlist_items (watchlist_id, symbol, position)
					SELECT ?, s, (ord - 1)::int FROM unnest(?::text[]) WITH ORDINALITY AS t(s, ord)""")
					.params(id, ordered.toArray(String[]::new))
					.update();
		}
		return get(userId, id);
	}

	@Transactional
	public List<Watchlist> reorder(UUID userId, List<UUID> ids) {
		List<UUID> current = jdbc.sql("SELECT id FROM watchlists WHERE user_id = ? FOR UPDATE").param(userId).query(UUID.class).list();
		if (ids.size() != current.size() || !new LinkedHashSet<>(ids).containsAll(current) || new LinkedHashSet<>(ids).size() != ids.size()) {
			throw Problems.badRequest("bad_order", "Order must list every watchlist exactly once");
		}
		for (int i = 0; i < ids.size(); i++) {
			jdbc.sql("UPDATE watchlists SET position = ? WHERE id = ?").params(i, ids.get(i)).update();
		}
		return list(userId);
	}

	private UUID insert(UUID userId, String name) {
		return jdbc.sql("""
				INSERT INTO watchlists (user_id, name, position)
				VALUES (?, ?, (SELECT coalesce(max(position) + 1, 0) FROM watchlists WHERE user_id = ?)) RETURNING id""")
				.params(userId, name, userId)
				.query(UUID.class)
				.single();
	}
}
