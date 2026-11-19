package in.arth.api.market;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.util.Map;
import java.util.Optional;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Component;

/** Reads the latest quote the tick-aggregator keeps in the Redis hash {@code ltp:{symbol}}. */
@Component
public class QuoteCache {

	public record Quote(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal ltp,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal open,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal high,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal low,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal prevClose,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) long volume,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) long tsMs) {}

	private final StringRedisTemplate redis;

	QuoteCache(StringRedisTemplate redis) {
		this.redis = redis;
	}

	public Optional<Quote> get(String symbol) {
		Map<Object, Object> h = redis.opsForHash().entries("ltp:" + symbol);
		if (h.isEmpty() || h.get("ltp") == null) {
			return Optional.empty();
		}
		return Optional.of(new Quote(dec(h, "ltp"), dec(h, "open"), dec(h, "high"), dec(h, "low"), dec(h, "prevClose"),
				Long.parseLong(String.valueOf(h.getOrDefault("volume", "0"))), Long.parseLong(String.valueOf(h.getOrDefault("ts", "0")))));
	}

	private static BigDecimal dec(Map<Object, Object> h, String key) {
		Object v = h.get(key);
		return v == null ? BigDecimal.ZERO : new BigDecimal(v.toString());
	}
}
