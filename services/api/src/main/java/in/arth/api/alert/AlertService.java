package in.arth.api.alert;

import in.arth.api.common.Problems;
import in.arth.api.market.InstrumentRepository;
import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.OffsetDateTime;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;

/**
 * Alerts live in Postgres; the alert-engine keeps its own per-symbol Redis index. Every change is announced on the Redis
 * channel {@code alerts:changed} with the alert id, and the engine re-reads that row, so Postgres stays the source of truth.
 */
@Service
public class AlertService {

	public static final int MAX_ACTIVE = 50;
	public static final String CHANGED_CHANNEL = "alerts:changed";

	public enum Kind {
		above, below, pct_move
	}

	public record Alert(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String symbol,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) Kind kind,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal value,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean active,
			OffsetDateTime lastFiredAt,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) OffsetDateTime createdAt) {}

	private static final String SELECT = """
			SELECT a.id, a.symbol, i.name, a.kind, a.value, a.active, a.last_fired_at, a.created_at
			FROM alerts a JOIN instruments i ON i.symbol = a.symbol""";

	private final JdbcClient jdbc;
	private final InstrumentRepository instruments;
	private final StringRedisTemplate redis;

	AlertService(JdbcClient jdbc, InstrumentRepository instruments, StringRedisTemplate redis) {
		this.jdbc = jdbc;
		this.instruments = instruments;
		this.redis = redis;
	}

	public List<Alert> list(UUID userId) {
		return jdbc.sql(SELECT + " WHERE a.user_id = ? ORDER BY a.active DESC, a.created_at DESC").param(userId).query(this::row).list();
	}

	public Alert create(UUID userId, String symbol, Kind kind, BigDecimal value) {
		String sym = symbol.trim().toUpperCase();
		instruments.find(sym).orElseThrow(() -> Problems.badRequest("unknown_symbol", "No instrument " + sym));
		validate(kind, value);
		checkCap(userId);
		UUID id = jdbc.sql("INSERT INTO alerts (user_id, symbol, kind, value) VALUES (?, ?, ?, ?) RETURNING id")
				.params(userId, sym, kind.name(), value).query(UUID.class).single();
		announce(id);
		return get(userId, id);
	}

	public Alert update(UUID userId, UUID id, Optional<BigDecimal> value, Optional<Boolean> active) {
		Alert current = get(userId, id);
		BigDecimal v = value.orElse(current.value());
		validate(current.kind(), v);
		boolean act = active.orElse(current.active());
		if (act && !current.active()) {
			checkCap(userId);
		}
		jdbc.sql("UPDATE alerts SET value = ?, active = ? WHERE id = ? AND user_id = ?").params(v, act, id, userId).update();
		announce(id);
		return get(userId, id);
	}

	public void delete(UUID userId, UUID id) {
		if (jdbc.sql("DELETE FROM alerts WHERE id = ? AND user_id = ?").params(id, userId).update() == 0) {
			throw Problems.notFound("Alert");
		}
		announce(id);
	}

	Alert get(UUID userId, UUID id) {
		return jdbc.sql(SELECT + " WHERE a.id = ? AND a.user_id = ?").params(id, userId).query(this::row).optional()
				.orElseThrow(() -> Problems.notFound("Alert"));
	}

	private void checkCap(UUID userId) {
		int active = jdbc.sql("SELECT count(*) FROM alerts WHERE user_id = ? AND active").param(userId).query(Integer.class).single();
		if (active >= MAX_ACTIVE) {
			throw Problems.conflict("alert_limit", "At most " + MAX_ACTIVE + " active alerts");
		}
	}

	private static void validate(Kind kind, BigDecimal value) {
		if (value.signum() <= 0) {
			throw Problems.badRequest("bad_value", "value must be positive");
		}
		if (kind == Kind.pct_move && (value.compareTo(new BigDecimal("0.5")) < 0 || value.compareTo(new BigDecimal("50")) > 0)) {
			throw Problems.badRequest("bad_value", "pct_move must be between 0.5 and 50 percent");
		}
	}

	private void announce(UUID id) {
		redis.convertAndSend(CHANGED_CHANNEL, id.toString());
	}

	private Alert row(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
		return new Alert(rs.getObject(1, UUID.class), rs.getString(2), rs.getString(3), Kind.valueOf(rs.getString(4)),
				rs.getBigDecimal(5).stripTrailingZeros(), rs.getBoolean(6), rs.getObject(7, OffsetDateTime.class),
				rs.getObject(8, OffsetDateTime.class));
	}
}
