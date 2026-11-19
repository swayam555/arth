package in.arth.api.portfolio;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeFormatterBuilder;
import java.time.format.DateTimeParseException;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

final class Parsing {

	private static final List<DateTimeFormatter> DATES = List.of(
			fmt("yyyy-MM-dd"), fmt("dd-MM-yyyy"), fmt("dd/MM/yyyy"), fmt("dd-MMM-yyyy"), fmt("dd MMM yyyy"),
			fmt("d-MMM-yyyy"), fmt("d/M/yyyy"), fmt("dd.MM.yyyy"), fmt("yyyy/MM/dd"));

	private Parsing() {}

	private static DateTimeFormatter fmt(String pattern) {
		return new DateTimeFormatterBuilder().parseCaseInsensitive().appendPattern(pattern).toFormatter(Locale.ENGLISH);
	}

	static Optional<LocalDate> date(String raw) {
		if (raw == null) {
			return Optional.empty();
		}
		String s = raw.trim();
		if (s.length() > 10 && s.matches("^\\d{4}-\\d{2}-\\d{2}[T ].*")) {
			s = s.substring(0, 10);
		}
		for (DateTimeFormatter f : DATES) {
			try {
				return Optional.of(LocalDate.parse(s, f));
			} catch (DateTimeParseException ignored) {
				// try the next layout
			}
		}
		return Optional.empty();
	}

	/** Accepts Indian digit grouping, a rupee sign, and accounting parentheses for negatives. */
	static Optional<BigDecimal> number(String raw) {
		if (raw == null) {
			return Optional.empty();
		}
		String s = raw.trim().replace("₹", "").replace("Rs.", "").replace(",", "").replace(" ", "");
		boolean neg = s.startsWith("(") && s.endsWith(")");
		if (neg) {
			s = s.substring(1, s.length() - 1);
		}
		if (!s.matches("^-?\\d+(\\.\\d+)?$")) {
			return Optional.empty();
		}
		BigDecimal v = new BigDecimal(s);
		return Optional.of(neg ? v.negate() : v);
	}
}
