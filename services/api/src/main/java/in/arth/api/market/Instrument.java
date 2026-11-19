package in.arth.api.market;

import io.swagger.v3.oas.annotations.media.Schema;
import java.math.BigDecimal;
import java.sql.ResultSet;
import java.sql.SQLException;

public record Instrument(
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String symbol,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String isin,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String name,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) String sector,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"large", "mid", "small"}) String mcapBucket,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED, allowableValues = {"equity", "etf"}) String assetClass,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) int lotSize,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal tickSize,
		@Schema(requiredMode = Schema.RequiredMode.REQUIRED) BigDecimal prevClose,
		Integer circuitPct) {

	static final String COLUMNS = "symbol, isin, name, sector, mcap_bucket, asset_class, lot_size, tick_size, prev_close, circuit_pct";

	static Instrument map(ResultSet rs, int n) throws SQLException {
		return new Instrument(rs.getString("symbol"), rs.getString("isin"), rs.getString("name"), rs.getString("sector"),
				rs.getString("mcap_bucket"), rs.getString("asset_class"), rs.getInt("lot_size"), rs.getBigDecimal("tick_size"),
				rs.getBigDecimal("prev_close"), (Integer) rs.getObject("circuit_pct"));
	}
}
