package in.arth.api.portfolio;

import java.math.BigDecimal;
import java.math.MathContext;
import java.math.RoundingMode;
import java.time.LocalDate;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/** Weighted-average-cost position keeping, the convention Indian brokers use for holdings. */
public final class Ledger {

	public record Position(String symbol, BigDecimal qty, BigDecimal cost, BigDecimal realized) {
		public BigDecimal avgCost() {
			return qty.signum() == 0 ? BigDecimal.ZERO : cost.divide(qty, MathContext.DECIMAL64);
		}
	}

	public static final class OversellException extends RuntimeException {
		public final String symbol;
		public final LocalDate date;

		OversellException(String symbol, LocalDate date, BigDecimal held, BigDecimal sold) {
			super("Selling %s %s on %s but only %s held".formatted(sold.stripTrailingZeros().toPlainString(), symbol, date,
					held.stripTrailingZeros().toPlainString()));
			this.symbol = symbol;
			this.date = date;
		}
	}

	static final Comparator<Txn> ORDER = Comparator.comparing(Txn::tradeDate).thenComparing(t -> t.side() == Txn.Side.SELL);

	private Ledger() {}

	/** Replays trades in date order (buys before sells on the same day). Includes closed positions. */
	public static Map<String, Position> replay(List<Txn> txns, LocalDate asOf) {
		Map<String, Position> out = new LinkedHashMap<>();
		for (Txn t : txns.stream().sorted(ORDER).toList()) {
			if (asOf != null && t.tradeDate().isAfter(asOf)) {
				break;
			}
			Position p = out.getOrDefault(t.symbol(), new Position(t.symbol(), BigDecimal.ZERO, BigDecimal.ZERO, BigDecimal.ZERO));
			if (t.side() == Txn.Side.BUY) {
				p = new Position(p.symbol(), p.qty().add(t.qty()), p.cost().add(t.qty().multiply(t.price())), p.realized());
			} else {
				if (t.qty().compareTo(p.qty()) > 0) {
					throw new OversellException(t.symbol(), t.tradeDate(), p.qty(), t.qty());
				}
				BigDecimal avg = p.avgCost();
				BigDecimal left = p.qty().subtract(t.qty());
				BigDecimal cost = left.signum() == 0 ? BigDecimal.ZERO : p.cost().subtract(avg.multiply(t.qty())).setScale(6, RoundingMode.HALF_EVEN);
				BigDecimal realized = p.realized().add(t.price().subtract(avg).multiply(t.qty()));
				p = new Position(p.symbol(), left, cost, realized);
			}
			out.put(t.symbol(), p);
		}
		return out;
	}

	public static Map<String, Position> replay(List<Txn> txns) {
		return replay(txns, null);
	}
}
