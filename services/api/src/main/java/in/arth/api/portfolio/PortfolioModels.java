package in.arth.api.portfolio;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;

public final class PortfolioModels {

	private PortfolioModels() {}

	public record Holding(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String symbol,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String sector,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String mcapBucket,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String assetClass,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal qty,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal avgCost,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal invested,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal ltp,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal prevClose,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal value,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal dayChange,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) double dayChangePct,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal pnl,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) double pnlPct,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) double weight,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "False when no live quote was available and prevClose was used") boolean live) {}

	public record Slice(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String key,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal value,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) double weight) {}

	public record Allocation(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Slice> sector,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Slice> mcap,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Slice> asset) {}

	public record Summary(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) long version,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal invested,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal value,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal dayChange,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) double dayChangePct,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal pnl,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) double pnlPct,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal realized,
			@Schema(description = "Annualised money-weighted return; absent with fewer than two cash flows") Double xirr,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Holding> holdings,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) Allocation allocation,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Holding> gainers,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Holding> losers,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) int txnCount) {}

	public record Point(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) LocalDate date,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal value,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal invested) {}

	public record History(
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED) List<Point> points,
			@Schema(requiredMode = Schema.RequiredMode.REQUIRED, description = "Share of symbol-days priced from a trade instead of a daily close") double estimatedShare) {}
}
