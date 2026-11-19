package in.arth.api.common;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.security.SecureRandom;
import java.util.Base64;

public final class Hashing {

	private static final SecureRandom RANDOM = new SecureRandom();

	private Hashing() {}

	public static byte[] sha256(byte[] input) {
		try {
			return MessageDigest.getInstance("SHA-256").digest(input);
		} catch (NoSuchAlgorithmException e) {
			throw new IllegalStateException(e);
		}
	}

	public static byte[] sha256(String input) {
		return sha256(input.getBytes(StandardCharsets.UTF_8));
	}

	public static String randomToken(int bytes) {
		byte[] buf = new byte[bytes];
		RANDOM.nextBytes(buf);
		return Base64.getUrlEncoder().withoutPadding().encodeToString(buf);
	}

	public static String randomDigits(int length) {
		StringBuilder sb = new StringBuilder(length);
		for (int i = 0; i < length; i++) {
			sb.append(RANDOM.nextInt(10));
		}
		return sb.toString();
	}
}
