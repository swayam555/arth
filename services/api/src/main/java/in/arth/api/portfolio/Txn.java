package in.arth.api.portfolio;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.UUID;

public record Txn(
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) UUID id,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String symbol,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"BUY", "SELL"}) Side side,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal qty,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal price,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) LocalDate tradeDate,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"manual", "csv", "cas"}) String source) {

	public enum Side { BUY, SELL }
}
