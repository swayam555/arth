package in.arth.api.portfolio;

import in.arth.api.portfolio.ImportReport.Draft;
import in.arth.api.portfolio.ImportReport.Issue;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;

/** Broker tradebook CSV → trades, with header auto-detection, explicit column mapping and a per-row report. */
public final class CsvImport {

	public static final List<String> FIELDS = List.of("symbol", "side", "qty", "price", "date");
	public static final int MAX_ROWS = 5_000;
	static final int MAX_ISSUES = 200;

	private static final Map<String, List<String>> SYNONYMS = Map.of(
			"symbol", List.of("symbol", "tradingsymbol", "scrip", "scripcode", "stock", "ticker", "instrument", "security", "isin"),
			"side", List.of("side", "tradetype", "type", "transactiontype", "buysell", "action", "txntype"),
			"qty", List.of("qty", "quantity", "units", "shares", "noofshares"),
			"price", List.of("price", "tradeprice", "rate", "avgprice", "averageprice", "nav", "priceperunit"),
			"date", List.of("tradedate", "date", "transactiondate", "txndate", "orderexecutiontime", "executiontime"));

	public record Result(List<String> headers, Map<String, String> mapping, List<Draft> drafts, List<Issue> issues, int dataRows) {}

	private CsvImport() {}

	static String norm(String header) {
		return header.toLowerCase(Locale.ROOT).replaceAll("[^a-z0-9]", "");
	}

	/** RFC 4180: quoted fields, doubled quotes, CRLF or LF, and a UTF-8 BOM. */
	public static List<List<String>> parse(String text) {
		List<List<String>> rows = new ArrayList<>();
		List<String> row = new ArrayList<>();
		StringBuilder cell = new StringBuilder();
		boolean quoted = false;
		int i = text.startsWith("﻿") ? 1 : 0;
		for (; i < text.length(); i++) {
			char c = text.charAt(i);
			if (quoted) {
				if (c == '"' && i + 1 < text.length() && text.charAt(i + 1) == '"') {
					cell.append('"');
					i++;
				} else if (c == '"') {
					quoted = false;
				} else {
					cell.append(c);
				}
			} else if (c == '"') {
				quoted = true;
			} else if (c == ',') {
				row.add(cell.toString());
				cell.setLength(0);
			} else if (c == '\n' || c == '\r') {
				if (c == '\r' && i + 1 < text.length() && text.charAt(i + 1) == '\n') {
					i++;
				}
				row.add(cell.toString());
				cell.setLength(0);
				if (!(row.size() == 1 && row.getFirst().isBlank())) {
					rows.add(row);
				}
				row = new ArrayList<>();
			} else {
				cell.append(c);
			}
		}
		if (!cell.isEmpty() || !row.isEmpty()) {
			row.add(cell.toString());
			if (!(row.size() == 1 && row.getFirst().isBlank())) {
				rows.add(row);
			}
		}
		return rows;
	}

	/** Best guess of field → header; each header is used at most once, in synonym priority order. */
	public static Map<String, String> detect(List<String> headers) {
		Map<String, String> out = new LinkedHashMap<>();
		List<String> normed = headers.stream().map(CsvImport::norm).toList();
		for (String field : FIELDS) {
			for (String syn : SYNONYMS.get(field)) {
				int idx = normed.indexOf(syn);
				if (idx >= 0 && !out.containsValue(headers.get(idx))) {
					out.put(field, headers.get(idx));
					break;
				}
			}
		}
		return out;
	}

	public static Result read(String text, Map<String, String> requested, Function<String, Optional<String>> resolveSymbol, LocalDate today) {
		List<List<String>> rows = parse(text);
		List<Issue> issues = new ArrayList<>();
		if (rows.isEmpty()) {
			issues.add(new Issue(0, "file", "The file is empty"));
			return new Result(List.of(), Map.of(), List.of(), issues, 0);
		}
		List<String> headers = rows.getFirst().stream().map(String::trim).toList();
		Map<String, String> mapping = new LinkedHashMap<>(detect(headers));
		if (requested != null) {
			requested.forEach((field, header) -> {
				if (FIELDS.contains(field) && header != null && !header.isBlank()) {
					mapping.put(field, header);
				}
			});
		}
		Map<String, Integer> col = new LinkedHashMap<>();
		for (String field : FIELDS) {
			String header = mapping.get(field);
			int idx = header == null ? -1 : headers.indexOf(header);
			if (idx < 0) {
				issues.add(new Issue(1, field, header == null ? "No column mapped" : "Column '" + header + "' not found"));
			}
			col.put(field, idx);
		}
		int dataRows = rows.size() - 1;
		if (!issues.isEmpty()) {
			return new Result(headers, mapping, List.of(), issues, dataRows);
		}
		if (dataRows > MAX_ROWS) {
			issues.add(new Issue(0, "file", "More than " + MAX_ROWS + " rows; split the file"));
			return new Result(headers, mapping, List.of(), issues, dataRows);
		}
		List<Draft> drafts = new ArrayList<>();
		for (int r = 1; r < rows.size(); r++) {
			List<String> row = rows.get(r);
			int line = r + 1;
			List<Issue> rowIssues = new ArrayList<>();
			String rawSymbol = cell(row, col.get("symbol")).toUpperCase(Locale.ROOT).replaceAll("-(EQ|BE)$", "");
			Optional<String> symbol = rawSymbol.isEmpty() ? Optional.empty() : resolveSymbol.apply(rawSymbol);
			if (symbol.isEmpty()) {
				rowIssues.add(new Issue(line, "symbol", rawSymbol.isEmpty() ? "Missing" : "Unknown symbol or ISIN '" + rawSymbol + "'"));
			}
			Txn.Side side = switch (cell(row, col.get("side")).trim().toUpperCase(Locale.ROOT)) {
				case "BUY", "B", "PURCHASE", "P" -> Txn.Side.BUY;
				case "SELL", "S", "SALE", "REDEMPTION", "R" -> Txn.Side.SELL;
				default -> null;
			};
			if (side == null) {
				rowIssues.add(new Issue(line, "side", "Expected buy or sell, got '" + cell(row, col.get("side")) + "'"));
			}
			Optional<BigDecimal> qty = Parsing.number(cell(row, col.get("qty"))).filter(q -> q.signum() > 0);
			if (qty.isEmpty()) {
				rowIssues.add(new Issue(line, "qty", "Expected a positive number, got '" + cell(row, col.get("qty")) + "'"));
			}
			Optional<BigDecimal> price = Parsing.number(cell(row, col.get("price"))).filter(p -> p.signum() >= 0);
			if (price.isEmpty()) {
				rowIssues.add(new Issue(line, "price", "Expected a non-negative number, got '" + cell(row, col.get("price")) + "'"));
			}
			Optional<LocalDate> date = Parsing.date(cell(row, col.get("date")));
			if (date.isEmpty()) {
				rowIssues.add(new Issue(line, "date", "Unrecognised date '" + cell(row, col.get("date")) + "'"));
			} else if (date.get().isAfter(today)) {
				rowIssues.add(new Issue(line, "date", "Date is in the future"));
			}
			if (rowIssues.isEmpty()) {
				drafts.add(new Draft(symbol.get(), side, qty.get(), price.get(), date.get()));
			} else if (issues.size() < MAX_ISSUES) {
				issues.addAll(rowIssues.subList(0, Math.min(rowIssues.size(), MAX_ISSUES - issues.size())));
			}
		}
		return new Result(headers, mapping, drafts, issues, dataRows);
	}

	private static String cell(List<String> row, int idx) {
		return idx >= 0 && idx < row.size() ? row.get(idx).trim() : "";
	}
}
