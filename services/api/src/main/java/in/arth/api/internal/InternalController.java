package in.arth.api.internal;

import in.arth.api.common.CurrentUser;
import in.arth.api.common.Problems;
import in.arth.api.market.InstrumentRepository;
import in.arth.api.portfolio.PortfolioModels.History;
import in.arth.api.portfolio.PortfolioModels.Summary;
import in.arth.api.portfolio.PortfolioService;
import in.arth.api.user.ConsentService;
import io.swagger.v3.oas.annotations.Hidden;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

/** Read-only, user-scoped endpoints for the ai service. The user is always the token subject, never a path parameter. */
@Hidden
@RestController
@RequestMapping("/internal/v1")
class InternalController {

	record Close(LocalDate date, double close) {}

	record Closes(String symbol, String name, List<Close> closes) {}

	private final PortfolioService portfolio;
	private final ConsentService consents;
	private final InstrumentRepository instruments;
	private final JdbcClient jdbc;

	InternalController(PortfolioService portfolio, ConsentService consents, InstrumentRepository instruments, JdbcClient jdbc) {
		this.portfolio = portfolio;
		this.consents = consents;
		this.instruments = instruments;
		this.jdbc = jdbc;
	}

	@GetMapping("/consents")
	Map<String, Boolean> consents() {
		return consents.current(CurrentUser.id());
	}

	@GetMapping("/portfolio")
	Summary portfolio() {
		return portfolio.summary(CurrentUser.id());
	}

	@GetMapping("/portfolio/history")
	History history(@RequestParam(defaultValue = "30") int days) {
		if (days < 1 || days > 365) {
			throw Problems.badRequest("bad_days", "days must be between 1 and 365");
		}
		return portfolio.history(CurrentUser.id(), days);
	}

	@GetMapping("/instruments/{symbol}/closes")
	Closes closes(@PathVariable String symbol, @RequestParam(defaultValue = "30") int days) {
		if (days < 1 || days > 365) {
			throw Problems.badRequest("bad_days", "days must be between 1 and 365");
		}
		String sym = symbol.toUpperCase();
		var inst = instruments.find(sym).orElseThrow(() -> Problems.notFound("Instrument"));
		List<Close> rows = jdbc.sql("""
				SELECT (bucket AT TIME ZONE 'Asia/Kolkata')::date AS d, c FROM candles_1d
				WHERE symbol = ? AND bucket >= now() - make_interval(days => ?) ORDER BY bucket""")
				.params(sym, days)
				.query((rs, i) -> new Close(rs.getObject(1, LocalDate.class), rs.getDouble(2)))
				.list();
		return new Closes(sym, inst.name(), rows);
	}
}
