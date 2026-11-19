package in.arth.api.market;

import in.arth.api.common.Problems;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.constraints.Max;
import jakarta.validation.constraints.Min;
import jakarta.validation.constraints.Size;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

@RestController
@RequestMapping("/v1/instruments")
@Validated
class InstrumentController {

	record Page(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Instrument> items, String nextCursor) {}

	record Detail(@Schema(requiredMode = Schema.RequiredMode.REQUIRED) Instrument instrument, QuoteCache.Quote quote) {}

	private final InstrumentRepository instruments;
	private final QuoteCache quotes;

	InstrumentController(InstrumentRepository instruments, QuoteCache quotes) {
		this.instruments = instruments;
		this.quotes = quotes;
	}

	@GetMapping
	Page search(@RequestParam(required = false) @Size(max = 40) String q,
			@RequestParam(required = false) @Size(max = 40) String sector,
			@RequestParam(required = false) String cursor,
			@RequestParam(defaultValue = "30") @Min(1) @Max(100) int limit) {
		int offset = decode(cursor);
		List<Instrument> rows = instruments.search(q, sector, offset, limit + 1);
		boolean more = rows.size() > limit;
		List<Instrument> items = more ? rows.subList(0, limit) : rows;
		return new Page(items, more ? encode(offset + limit) : null);
	}

	@GetMapping("/sectors")
	List<String> sectors() {
		return instruments.sectors();
	}

	@GetMapping("/{symbol}")
	Detail get(@PathVariable String symbol) {
		Instrument inst = instruments.find(symbol.toUpperCase()).orElseThrow(() -> Problems.notFound("Instrument"));
		return new Detail(inst, quotes.get(inst.symbol()).orElse(null));
	}

	private static String encode(int offset) {
		return Base64.getUrlEncoder().withoutPadding().encodeToString(("o:" + offset).getBytes(StandardCharsets.UTF_8));
	}

	private static int decode(String cursor) {
		if (cursor == null || cursor.isBlank()) {
			return 0;
		}
		try {
			String raw = new String(Base64.getUrlDecoder().decode(cursor), StandardCharsets.UTF_8);
			if (!raw.startsWith("o:")) {
				throw new IllegalArgumentException();
			}
			int offset = Integer.parseInt(raw.substring(2));
			if (offset < 0 || offset > 10_000) {
				throw new IllegalArgumentException();
			}
			return offset;
		} catch (IllegalArgumentException e) {
			throw Problems.badRequest("bad_cursor", "Cursor is not valid");
		}
	}
}
