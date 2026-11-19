package in.arth.api.portfolio;

import in.arth.api.common.CurrentUser;
import in.arth.api.common.Problems;
import in.arth.api.portfolio.PortfolioModels.History;
import in.arth.api.portfolio.PortfolioModels.Summary;
import io.swagger.v3.oas.annotations.media.Schema;
import jakarta.validation.Valid;
import jakarta.validation.constraints.DecimalMax;
import jakarta.validation.constraints.DecimalMin;
import jakarta.validation.constraints.Digits;
import jakarta.validation.constraints.NotBlank;
import jakarta.validation.constraints.NotNull;
import jakarta.validation.constraints.Pattern;
import java.io.IOException;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.DeleteMapping;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.ResponseStatus;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import tools.jackson.core.type.TypeReference;
import tools.jackson.databind.ObjectMapper;

@RestController
@RequestMapping("/v1/portfolio")
class PortfolioController {

	record TxnBody(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) @NotBlank @Pattern(regexp = "^[A-Z0-9&-]{1,20}$") String symbol,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"BUY", "SELL"}) @NotNull Txn.Side side,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) @NotNull @DecimalMin(value = "0", inclusive = false) @Digits(integer = 14, fraction = 4) BigDecimal qty,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) @NotNull @DecimalMin("0") @DecimalMax("10000000") @Digits(integer = 10, fraction = 4) BigDecimal price,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) @NotNull LocalDate tradeDate) {

		PortfolioService.TxnInput input() {
			return new PortfolioService.TxnInput(symbol, side, qty, price, tradeDate);
		}
	}

	private final PortfolioService portfolio;
	private final ObjectMapper json;

	PortfolioController(PortfolioService portfolio, ObjectMapper json) {
		this.portfolio = portfolio;
		this.json = json;
	}

	@GetMapping
	Summary summary() {
		return portfolio.summary(CurrentUser.id());
	}

	@GetMapping("/history")
	History history(@RequestParam(defaultValue = "90") int days) {
		if (days < 1 || days > 365) {
			throw Problems.badRequest("bad_days", "days must be between 1 and 365");
		}
		return portfolio.history(CurrentUser.id(), days);
	}

	@GetMapping("/transactions")
	List<Txn> transactions() {
		return portfolio.transactions(CurrentUser.id());
	}

	@PostMapping("/transactions")
	@ResponseStatus(HttpStatus.CREATED)
	Txn add(@Valid @RequestBody TxnBody body) {
		return portfolio.add(CurrentUser.id(), body.input());
	}

	@PutMapping("/transactions/{id}")
	Txn update(@PathVariable UUID id, @Valid @RequestBody TxnBody body) {
		return portfolio.update(CurrentUser.id(), id, body.input());
	}

	@DeleteMapping("/transactions/{id}")
	@ResponseStatus(HttpStatus.NO_CONTENT)
	void delete(@PathVariable UUID id) {
		portfolio.delete(CurrentUser.id(), id);
	}

	@PostMapping(path = "/import/csv", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	ImportReport importCsv(@RequestPart("file") MultipartFile file,
			@Schema(description = "JSON object of field → CSV header, fields: symbol, side, qty, price, date") @RequestParam(required = false) String mapping,
			@RequestParam(defaultValue = "true") boolean dryRun) {
		Map<String, String> m = null;
		if (mapping != null && !mapping.isBlank()) {
			try {
				m = json.readValue(mapping, new TypeReference<Map<String, String>>() {});
			} catch (RuntimeException e) {
				throw Problems.badRequest("bad_mapping", "mapping must be a JSON object of field to header");
			}
		}
		return portfolio.importCsv(CurrentUser.id(), bytes(file, 2 * 1024 * 1024), m, dryRun);
	}

	@PostMapping(path = "/import/cas", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
	ImportReport importCas(@RequestPart("file") MultipartFile file, @RequestParam(required = false) String password,
			@RequestParam(defaultValue = "true") boolean dryRun) {
		return portfolio.importCas(CurrentUser.id(), bytes(file, CasParser.MAX_BYTES), password, dryRun);
	}

	private static byte[] bytes(MultipartFile file, int max) {
		if (file.isEmpty()) {
			throw Problems.badRequest("empty_file", "The file is empty");
		}
		if (file.getSize() > max) {
			throw Problems.badRequest("file_too_large", "The file is larger than " + max / (1024 * 1024) + " MB");
		}
		try {
			return file.getBytes();
		} catch (IOException e) {
			throw Problems.badRequest("unreadable_file", "Could not read the upload");
		}
	}
}
