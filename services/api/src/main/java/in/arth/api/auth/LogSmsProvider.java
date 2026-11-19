package in.arth.api.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

@Component
@ConditionalOnProperty(name = "arth.otp.provider", havingValue = "log", matchIfMissing = true)
class LogSmsProvider implements SmsProvider {

	private static final Logger log = LoggerFactory.getLogger(LogSmsProvider.class);

	@Override
	public void sendOtp(String phoneE164, String code) {
		String masked = phoneE164.substring(0, 3) + "******" + phoneE164.substring(phoneE164.length() - 4);
		log.info("dev OTP for {} is {}", masked, code);
	}
}
