package in.arth.api.auth;

public interface SmsProvider {

	void sendOtp(String phoneE164, String code);
}
