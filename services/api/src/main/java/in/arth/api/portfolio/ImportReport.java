package in.arth.api.portfolio;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;

public record ImportReport(
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"csv", "cas"}) String kind,
		@Schema(allowableValues = {"CDSL", "NSDL", "CAMS"}) String provider,
		LocalDate statementDate,
		@Schema(description = "Masked PAN read from the statement") String pan,
		@Schema(description = "Masked email read from the statement") String email,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> headers,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) Map<String, String> mapping,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) int accepted,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Issue> rejected,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Draft> preview,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<String> warnings,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) boolean committed,
		UUID importId) {

	public record Issue(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) int row,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String field,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String message) {}

	public record Draft(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String symbol,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"BUY", "SELL"}) Txn.Side side,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal qty,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal price,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) LocalDate tradeDate) {}
}
