package in.arth.api.portfolio;

/** Masks identifiers read from statements; raw values are never stored or logged. */
public final class Masking {

	private Masking() {}

	public static String pan(String pan) {
		if (pan == null || pan.length() != 10) {
			return null;
		}
		return pan.substring(0, 2) + "XXXXX" + pan.substring(7);
	}

	public static String email(String email) {
		if (email == null) {
			return null;
		}
		int at = email.indexOf('@');
		if (at < 1) {
			return null;
		}
		String local = email.substring(0, at);
		String keep = local.substring(0, Math.min(2, local.length()));
		return keep + "*".repeat(Math.max(3, local.length() - keep.length())) + email.substring(at);
	}
}
