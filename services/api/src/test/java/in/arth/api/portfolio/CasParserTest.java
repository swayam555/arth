package in.arth.api.portfolio;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.LocalDate;
import java.util.Map;
import java.util.Optional;
import java.util.function.Function;
import org.junit.jupiter.api.Test;

class CasParserTest {

	private static final Map<String, String> ISINS = Map.of("INETCSX00001", "TCS", "INEINFY00004", "INFY", "INERELI00000", "RELIANCE",
			"INESBIN00006", "SBIN", "INENIFT00050", "NIFTYBEES");
	private static final Function<String, Optional<String>> RESOLVE = i -> Optional.ofNullable(ISINS.get(i));

	@Test
	void readsCdslHoldingsAndMasksIdentity() {
		var r = CasParser.read(CasFixtures.cdsl(), CasFixtures.PASSWORD, RESOLVE);
		assertThat(r.provider()).isEqualTo("CDSL");
		assertThat(r.statementDate()).isEqualTo(LocalDate.parse("2026-10-31"));
		assertThat(r.pan()).isEqualTo("ABXXXXX34F");
		assertThat(r.email()).isEqualTo("ra******@example.com");
		assertThat(r.drafts()).extracting(d -> d.symbol() + " " + d.qty().stripTrailingZeros().toPlainString() + " @" + d.price().stripTrailingZeros().toPlainString())
				.containsExactly("TCS 10 @3500", "INFY 25 @1500");
		assertThat(r.issues()).singleElement().satisfies(i -> assertThat(i.message()).contains("INEZZZZ99999"));
		assertThat(r.warnings()).anyMatch(w -> w.contains("holdings, not trades"));
	}

	@Test
	void readsNsdlAndRejectsInconsistentValue() {
		var r = CasParser.read(CasFixtures.nsdl(), CasFixtures.PASSWORD, RESOLVE);
		assertThat(r.provider()).isEqualTo("NSDL");
		assertThat(r.statementDate()).isEqualTo(LocalDate.parse("2026-10-31"));
		assertThat(r.drafts()).extracting(d -> d.symbol()).containsExactly("RELIANCE");
		assertThat(r.issues()).singleElement().satisfies(i -> assertThat(i.field()).isEqualTo("value"));
	}

	@Test
	void readsCamsTransactionsIncludingRedemptions() {
		var r = CasParser.read(CasFixtures.cams(), CasFixtures.PASSWORD, RESOLVE);
		assertThat(r.provider()).isEqualTo("CAMS");
		assertThat(r.drafts()).extracting(d -> d.side() + " " + d.qty().stripTrailingZeros().toPlainString() + " " + d.tradeDate())
				.containsExactly("BUY 20 2025-01-10", "BUY 19.231 2025-02-10", "SELL 10 2025-03-15");
		assertThat(r.drafts().getLast().price()).isEqualByComparingTo("270");
	}

	@Test
	void wrongPasswordAndUnknownFormatsFailWithCodes() {
		assertThatThrownBy(() -> CasParser.read(CasFixtures.cdsl(), "WRONG0000X", RESOLVE))
				.isInstanceOfSatisfying(CasParser.CasException.class, e -> assertThat(e.code).isEqualTo("cas_password"));
		assertThatThrownBy(() -> CasParser.read(CasFixtures.unrelated(), CasFixtures.PASSWORD, RESOLVE))
				.isInstanceOfSatisfying(CasParser.CasException.class, e -> assertThat(e.code).isEqualTo("cas_unrecognized"));
		assertThatThrownBy(() -> CasParser.read("not a pdf".getBytes(), "", RESOLVE))
				.isInstanceOfSatisfying(CasParser.CasException.class, e -> assertThat(e.code).isEqualTo("cas_unreadable"));
	}
}
