package in.arth.api.portfolio;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.math.BigDecimal;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

class LedgerTest {

	private static Txn t(String sym, Txn.Side side, String qty, String price, String date) {
		return new Txn(UUID.randomUUID(), sym, side, new BigDecimal(qty), new BigDecimal(price), LocalDate.parse(date), "manual");
	}

	@Test
	void weightedAverageCostAndRealisedGain() {
		var p = Ledger.replay(List.of(
				t("TCS", Txn.Side.BUY, "10", "100", "2025-01-01"),
				t("TCS", Txn.Side.BUY, "10", "200", "2025-02-01"),
				t("TCS", Txn.Side.SELL, "5", "300", "2025-03-01"))).get("TCS");
		assertThat(p.qty()).isEqualByComparingTo("15");
		assertThat(p.avgCost()).isEqualByComparingTo("150");
		assertThat(p.cost()).isEqualByComparingTo("2250");
		assertThat(p.realized()).isEqualByComparingTo("750");
	}

	@Test
	void sameDayBuyIsAppliedBeforeSellRegardlessOfInputOrder() {
		var p = Ledger.replay(List.of(
				t("INFY", Txn.Side.SELL, "4", "120", "2025-01-01"),
				t("INFY", Txn.Side.BUY, "4", "100", "2025-01-01"))).get("INFY");
		assertThat(p.qty()).isEqualByComparingTo("0");
		assertThat(p.cost()).isEqualByComparingTo("0");
		assertThat(p.realized()).isEqualByComparingTo("80");
	}

	@Test
	void rejectsSellingMoreThanHeld() {
		assertThatThrownBy(() -> Ledger.replay(List.of(
				t("SBIN", Txn.Side.BUY, "1", "800", "2025-01-02"),
				t("SBIN", Txn.Side.SELL, "2", "810", "2025-01-03"))))
				.isInstanceOf(Ledger.OversellException.class)
				.hasMessageContaining("only 1 held");
	}

	@Test
	void asOfIgnoresLaterTrades() {
		var txns = List.of(t("ITC", Txn.Side.BUY, "10", "400", "2025-01-01"), t("ITC", Txn.Side.BUY, "10", "500", "2025-06-01"));
		assertThat(Ledger.replay(txns, LocalDate.parse("2025-03-01")).get("ITC").qty()).isEqualByComparingTo("10");
	}

	@Test
	void masksStatementIdentifiers() {
		assertThat(Masking.pan("ABCDE1234F")).isEqualTo("ABXXXXX34F");
		assertThat(Masking.email("ramesh.k@example.com")).isEqualTo("ra******@example.com");
		assertThat(Masking.email("a@b.in")).isEqualTo("a***@b.in");
	}
}
