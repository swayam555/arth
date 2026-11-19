package in.arth.api.auth;

import in.arth.api.common.Hashing;
import in.arth.api.common.Problems;
import in.arth.api.config.ArthProperties;
import java.security.MessageDigest;
import java.util.HexFormat;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.stereotype.Service;

@Service
class OtpService {

	private final StringRedisTemplate redis;
	private final SmsProvider sms;
	private final ArthProperties.Otp config;

	OtpService(StringRedisTemplate redis, SmsProvider sms, ArthProperties props) {
		this.redis = redis;
		this.sms = sms;
		this.config = props.otp();
	}

	void request(String phone) {
		boolean cooldownActive = !config.resendCooldown().isZero()
				&& !Boolean.TRUE.equals(redis.opsForValue().setIfAbsent("otp:cooldown:" + phone, "1", config.resendCooldown()));
		if (cooldownActive) {
			throw Problems.tooManyRequests("Wait before requesting another code");
		}
		String code = config.fixedCode() == null || config.fixedCode().isBlank() ? Hashing.randomDigits(6) : config.fixedCode();
		redis.opsForValue().set(codeKey(phone), hash(phone, code), config.ttl());
		redis.delete(attemptsKey(phone));
		sms.sendOtp(phone, code);
	}

	void verify(String phone, String code) {
		Long attempts = redis.opsForValue().increment(attemptsKey(phone));
		redis.expire(attemptsKey(phone), config.ttl());
		if (attempts != null && attempts > config.maxAttempts()) {
			redis.delete(codeKey(phone));
			throw Problems.tooManyRequests("Too many attempts; request a new code");
		}
		String expected = redis.opsForValue().get(codeKey(phone));
		if (expected == null || !MessageDigest.isEqual(expected.getBytes(), hash(phone, code).getBytes())) {
			throw Problems.unauthorized("invalid_otp", "The code is invalid or has expired");
		}
		redis.delete(codeKey(phone));
		redis.delete(attemptsKey(phone));
	}

	private static String hash(String phone, String code) {
		return HexFormat.of().formatHex(Hashing.sha256(phone + ":" + code));
	}

	private static String codeKey(String phone) {
		return "otp:code:" + phone;
	}

	private static String attemptsKey(String phone) {
		return "otp:attempts:" + phone;
	}
}
