package in.arth.api.ratelimit;

import java.util.List;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.script.RedisScript;
import org.springframework.stereotype.Component;

@Component
public class TokenBucket {

	// Atomic refill-then-take; state lives in one hash so any api instance sees the same bucket.
	private static final RedisScript<Long> SCRIPT = RedisScript.of("""
			local capacity = tonumber(ARGV[1])
			local refill = tonumber(ARGV[2])
			local now = tonumber(ARGV[3])
			local cost = tonumber(ARGV[4])
			local state = redis.call('HMGET', KEYS[1], 't', 'ts')
			local tokens = tonumber(state[1]) or capacity
			local ts = tonumber(state[2]) or now
			tokens = math.min(capacity, tokens + (now - ts) * refill / 1000)
			local allowed = 0
			if tokens >= cost then
			  tokens = tokens - cost
			  allowed = 1
			end
			redis.call('HSET', KEYS[1], 't', tokens, 'ts', now)
			redis.call('PEXPIRE', KEYS[1], math.ceil(capacity / refill * 1000) + 1000)
			return allowed
			""", Long.class);

	private final StringRedisTemplate redis;

	TokenBucket(StringRedisTemplate redis) {
		this.redis = redis;
	}

	public boolean tryConsume(String key, int capacity, double refillPerSecond) {
		Long allowed = redis.execute(SCRIPT, List.of("rl:" + key),
				String.valueOf(capacity), String.valueOf(refillPerSecond),
				String.valueOf(System.currentTimeMillis()), "1");
		return allowed != null && allowed == 1L;
	}
}
