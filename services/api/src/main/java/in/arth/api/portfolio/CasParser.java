package in.arth.api.portfolio;

import in.arth.api.portfolio.ImportReport.Draft;
import in.arth.api.portfolio.ImportReport.Issue;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.pdfbox.Loader;
import org.apache.pdfbox.pdmodel.PDDocument;
import org.apache.pdfbox.pdmodel.encryption.InvalidPasswordException;
import org.apache.pdfbox.text.PDFTextStripper;

/**
 * Consolidated Account Statement reader. Depository CAS (CDSL, NSDL) lists holdings as of the statement date;
 * a CAMS mutual-fund CAS lists dated transactions per scheme. Text is extracted position-sorted and parsed by line.
 */
public final class CasParser {

	public static final int MAX_BYTES = 10 * 1024 * 1024;
	static final int MAX_PAGES = 200;

	public static final class CasException extends RuntimeException {
		public final String code;

		CasException(String code, String message) {
			super(message);
			this.code = code;
		}
	}

	public record Result(String provider, LocalDate statementDate, String pan, String email, List<Draft> drafts, List<Issue> issues,
			List<String> warnings, int lines) {}

	private static final Pattern ISIN = Pattern.compile("\\b(IN[A-Z0-9]{10})\\b");
	private static final Pattern NUMBER = Pattern.compile("\\(?-?[\\d,]+(?:\\.\\d+)?\\)?");
	private static final Pattern PAN = Pattern.compile("\\b([A-Z]{5}[0-9]{4}[A-Z])\\b");
	private static final Pattern EMAIL = Pattern.compile("\\b([A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\\.[A-Za-z]{2,})\\b");
	private static final Pattern PERIOD_END = Pattern.compile("(?i)\\b(?:to|as on|as of)\\s+(\\d{2}[-/](?:\\d{2}|[A-Za-z]{3})[-/]\\d{4})");
	private static final Pattern CAMS_TXN = Pattern.compile("^(\\d{2}-[A-Za-z]{3}-\\d{4})\\s+(.+?)\\s+(\\(?[\\d,]+\\.\\d+\\)?)\\s+(\\(?[\\d,]+\\.\\d+\\)?)\\s+([\\d,]+\\.\\d+)\\s+([\\d,]+\\.\\d+)\\s*$");

	private CasParser() {}

	public static Result read(byte[] pdf, String password, Function<String, Optional<String>> resolveIsin) {
		if (pdf.length > MAX_BYTES) {
			throw new CasException("cas_too_large", "The statement is larger than 10 MB");
		}
		String text;
		try (PDDocument doc = Loader.loadPDF(pdf, password == null ? "" : password)) {
			if (doc.getNumberOfPages() > MAX_PAGES) {
				throw new CasException("cas_too_large", "The statement has more than " + MAX_PAGES + " pages");
			}
			PDFTextStripper stripper = new PDFTextStripper();
			stripper.setSortByPosition(true);
			text = stripper.getText(doc);
		} catch (InvalidPasswordException e) {
			throw new CasException("cas_password", "Wrong or missing password; a CAS is usually locked with your PAN");
		} catch (IOException e) {
			throw new CasException("cas_unreadable", "Not a readable PDF");
		}
		return parseText(text, resolveIsin);
	}

	static Result parseText(String text, Function<String, Optional<String>> resolveIsin) {
		String provider = text.contains("Central Depository Services") ? "CDSL"
				: text.contains("National Securities Depository") ? "NSDL"
				: text.contains("Computer Age Management Services") || text.contains("CAMS") ? "CAMS" : null;
		if (provider == null) {
			throw new CasException("cas_unrecognized", "Not a CDSL, NSDL or CAMS consolidated account statement");
		}
		LocalDate statementDate = find(PERIOD_END, text).flatMap(Parsing::date).orElse(null);
		String pan = find(PAN, text).map(Masking::pan).orElse(null);
		String email = find(EMAIL, text).map(Masking::email).orElse(null);
		List<String> lines = text.lines().map(String::strip).filter(l -> !l.isEmpty()).toList();
		List<Draft> drafts = new ArrayList<>();
		List<Issue> issues = new ArrayList<>();
		List<String> warnings = new ArrayList<>();
		if ("CAMS".equals(provider)) {
			parseCams(lines, resolveIsin, drafts, issues);
		} else {
			if (statementDate == null) {
				throw new CasException("cas_unrecognized", "Could not find the statement date");
			}
			parseHoldings(lines, statementDate, resolveIsin, drafts, issues);
			if (!drafts.isEmpty()) {
				warnings.add("A depository statement lists holdings, not trades: each holding is recorded as one buy on "
						+ statementDate + " at the statement price. Edit the price to your real cost for accurate P&L and XIRR.");
			}
		}
		if (drafts.isEmpty() && issues.isEmpty()) {
			warnings.add("No holdings or transactions found in the statement");
		}
		return new Result(provider, statementDate, pan, email, drafts, issues, warnings, lines.size());
	}

	private static void parseHoldings(List<String> lines, LocalDate date, Function<String, Optional<String>> resolveIsin, List<Draft> drafts,
			List<Issue> issues) {
		for (int i = 0; i < lines.size(); i++) {
			String line = lines.get(i);
			Matcher isin = ISIN.matcher(line);
			if (!isin.find()) {
				continue;
			}
			List<BigDecimal> nums = numbersAfter(line, isin.end());
			if (nums.size() < 3) {
				continue;
			}
			BigDecimal qty = nums.getFirst();
			BigDecimal price = nums.get(nums.size() - 2);
			BigDecimal value = nums.getLast();
			int row = i + 1;
			if (qty.signum() <= 0) {
				continue;
			}
			BigDecimal expected = qty.multiply(price);
			if (expected.subtract(value).abs().compareTo(value.abs().multiply(new BigDecimal("0.01")).max(BigDecimal.ONE)) > 0) {
				issues.add(new Issue(row, "value", "Quantity × price does not match the value for " + isin.group(1)));
				continue;
			}
			Optional<String> symbol = resolveIsin.apply(isin.group(1));
			if (symbol.isEmpty()) {
				issues.add(new Issue(row, "symbol", "ISIN " + isin.group(1) + " is not in the instrument universe"));
				continue;
			}
			drafts.add(new Draft(symbol.get(), Txn.Side.BUY, qty, price, date));
		}
	}

	private static void parseCams(List<String> lines, Function<String, Optional<String>> resolveIsin, List<Draft> drafts, List<Issue> issues) {
		String scheme = null;
		Optional<String> symbol = Optional.empty();
		for (int i = 0; i < lines.size(); i++) {
			String line = lines.get(i);
			Matcher isin = ISIN.matcher(line);
			if (line.contains("ISIN") && isin.find()) {
				scheme = isin.group(1);
				symbol = resolveIsin.apply(scheme);
				if (symbol.isEmpty()) {
					issues.add(new Issue(i + 1, "symbol", "ISIN " + scheme + " is not in the instrument universe"));
				}
				continue;
			}
			Matcher m = CAMS_TXN.matcher(line);
			if (scheme == null || !m.matches()) {
				continue;
			}
			if (symbol.isEmpty()) {
				continue;
			}
			Optional<LocalDate> date = Parsing.date(m.group(1));
			Optional<BigDecimal> units = Parsing.number(m.group(4));
			Optional<BigDecimal> nav = Parsing.number(m.group(5));
			if (date.isEmpty() || units.isEmpty() || nav.isEmpty() || units.get().signum() == 0) {
				issues.add(new Issue(i + 1, "row", "Unreadable transaction line"));
				continue;
			}
			Txn.Side side = units.get().signum() < 0 ? Txn.Side.SELL : Txn.Side.BUY;
			drafts.add(new Draft(symbol.get(), side, units.get().abs(), nav.get(), date.get()));
		}
	}

	private static List<BigDecimal> numbersAfter(String line, int from) {
		List<BigDecimal> out = new ArrayList<>();
		Matcher m = NUMBER.matcher(line.substring(from));
		while (m.find()) {
			Parsing.number(m.group()).ifPresent(out::add);
		}
		return out;
	}

	private static Optional<String> find(Pattern p, String text) {
		Matcher m = p.matcher(text);
		return m.find() ? Optional.of(m.group(1)) : Optional.empty();
	}

}
