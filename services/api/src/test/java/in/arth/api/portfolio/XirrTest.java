package in.arth.api.portfolio;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.within;

import java.time.LocalDate;
import java.util.List;
import org.junit.jupiter.api.Test;

class XirrTest {

	private static Xirr.Flow f(double amount, String date) {
		return new Xirr.Flow(LocalDate.parse(date), amount);
	}

	@Test
	void matchesTheExcelDocumentationExample() {
		var flows = List.of(f(-10000, "2008-01-01"), f(2750, "2008-03-01"), f(4250, "2008-10-30"), f(3250, "2009-02-15"), f(2750, "2009-04-01"));
		assertThat(Xirr.compute(flows).getAsDouble()).isCloseTo(0.373362535, within(1e-6));
	}

	// Reference values computed by LibreOffice Calc's XIRR on the same flows.
	@Test
	void matchesLibreOfficeOnSipLossAndExtremeCases() {
		var sip = List.of(f(-10000, "2024-01-15"), f(-10000, "2024-02-15"), f(-10000, "2024-03-15"), f(32500, "2024-12-31"));
		assertThat(Xirr.compute(sip).getAsDouble()).isCloseTo(0.0953649849401857, within(1e-6));
		var loss = List.of(f(-50000, "2023-06-01"), f(5000, "2023-12-01"), f(30000, "2025-06-01"));
		assertThat(Xirr.compute(loss).getAsDouble()).isCloseTo(-0.178540349509331, within(1e-6));
		var tripled = List.of(f(-1000, "2025-01-01"), f(3000, "2025-03-01"));
		assertThat(Xirr.compute(tripled).getAsDouble()).isCloseTo(893.710097083133, within(1e-3));
	}

	@Test
	void bisectionFindsTheRootWhenNewtonCannot() {
		var flows = List.of(f(-1000, "2025-01-01"), f(3000, "2025-03-01"));
		double[] t = {0, 59 / 365.0};
		double[] a = {-1000, 3000};
		var r = Xirr.bisection(t, a);
		assertThat(r).isPresent();
		assertThat(Math.abs(Xirr.npv(t, a, r.getAsDouble()))).isLessThan(1e-6);
		assertThat(Xirr.compute(flows, -0.99).isPresent()).isTrue();
	}

	@Test
	void isUndefinedWithoutBothSigns() {
		assertThat(Xirr.compute(List.of(f(-1, "2025-01-01")))).isEmpty();
		assertThat(Xirr.compute(List.of(f(-1, "2025-01-01"), f(-2, "2025-02-01")))).isEmpty();
	}
}
