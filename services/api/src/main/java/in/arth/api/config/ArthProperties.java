package in.arth.api.config;

import java.time.Duration;
import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties("arth")
public record ArthProperties(Jwt jwt, Otp otp, RateLimit rateLimit) {

	public record Jwt(String secret, String internalSecret, Duration accessTtl, Duration refreshTtl, String issuer) {}

	public record Otp(String provider, String fixedCode, Duration ttl, int maxAttempts, Duration resendCooldown) {}

	public record RateLimit(int capacity, int refillPerSecond) {}
}
