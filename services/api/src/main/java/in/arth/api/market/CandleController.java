package in.arth.api.market;

import in.arth.api.common.Problems;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
class CandleController {

	/** Each candle is [epochMs, open, high, low, close, volume], oldest first. */
	record Candles(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String tf,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<double[]> candles, Long nextBefore) {}

	private static final Map<String, String> TABLES = Map.of(
			"1m", "candles_1m", "5m", "candles_5m", "15m", "candles_15m", "1h", "candles_1h", "1d", "candles_1d");

	private final JdbcClient jdbc;
	private final InstrumentRepository instruments;

	CandleController(JdbcClient jdbc, InstrumentRepository instruments) {
		this.jdbc = jdbc;
		this.instruments = instruments;
	}

	@GetMapping("/v1/instruments/{symbol}/candles")
	Candles candles(@PathVariable String symbol,
			@RequestParam(defaultValue = "5m") String tf,
			@RequestParam(required = false) Long before,
			@RequestParam(defaultValue = "300") @Min(1) @Max(1000) int limit) {
		String table = TABLES.get(tf);
		if (table == null) {
			throw Problems.badRequest("bad_timeframe", "tf must be one of " + TABLES.keySet().stream().sorted().toList());
		}
		String sym = symbol.toUpperCase();
		instruments.find(sym).orElseThrow(() -> Problems.notFound("Instrument"));
		Timestamp until = Timestamp.from(before == null ? Instant.now().plusSeconds(86_400) : Instant.ofEpochMilli(before));
		List<double[]> rows = new ArrayList<>(jdbc.sql("""
				SELECT bucket, o, h, l, c, v FROM %s WHERE symbol = ? AND bucket < ? ORDER BY bucket DESC LIMIT ?""".formatted(table))
				.params(sym, until, limit)
				.query((rs, i) -> new double[] {rs.getTimestamp(1).getTime(), rs.getDouble(2), rs.getDouble(3), rs.getDouble(4),
						rs.getDouble(5), rs.getLong(6)})
				.list());
		Collections.reverse(rows);
		Long next = rows.size() == limit ? (long) rows.getFirst()[0] : null;
		return new Candles(tf, rows, next);
	}
}
