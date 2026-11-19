package in.arth.api.portfolio;

import java.time.LocalDate;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.OptionalDouble;

/** XIRR as spreadsheets define it: the rate r with sum(a_i / (1+r)^((d_i-d_0)/365)) = 0. */
public final class Xirr {

	public record Flow(LocalDate date, double amount) {}

	private static final double TOL = 1e-10;
	private static final double LOWER = -0.999_999_999;

	private Xirr() {}

	public static OptionalDouble compute(List<Flow> flows) {
		return compute(flows, 0.1);
	}

	public static OptionalDouble compute(List<Flow> flows, double guess) {
		if (flows.size() < 2) {
			return OptionalDouble.empty();
		}
		boolean pos = flows.stream().anyMatch(f -> f.amount() > 0);
		boolean neg = flows.stream().anyMatch(f -> f.amount() < 0);
		if (!pos || !neg) {
			return OptionalDouble.empty();
		}
		LocalDate d0 = flows.getFirst().date();
		double[] t = new double[flows.size()];
		double[] a = new double[flows.size()];
		for (int i = 0; i < t.length; i++) {
			t[i] = ChronoUnit.DAYS.between(d0, flows.get(i).date()) / 365.0;
			a[i] = flows.get(i).amount();
		}
		OptionalDouble newton = newton(t, a, guess);
		return newton.isPresent() ? newton : bisection(t, a);
	}

	static double npv(double[] t, double[] a, double r) {
		double s = 0;
		for (int i = 0; i < t.length; i++) {
			s += a[i] / Math.pow(1 + r, t[i]);
		}
		return s;
	}

	private static double dnpv(double[] t, double[] a, double r) {
		double s = 0;
		for (int i = 0; i < t.length; i++) {
			s -= t[i] * a[i] / Math.pow(1 + r, t[i] + 1);
		}
		return s;
	}

	static OptionalDouble newton(double[] t, double[] a, double guess) {
		double r = guess;
		for (int i = 0; i < 100; i++) {
			double f = npv(t, a, r);
			double df = dnpv(t, a, r);
			if (df == 0 || !Double.isFinite(f) || !Double.isFinite(df)) {
				return OptionalDouble.empty();
			}
			double next = r - f / df;
			if (!Double.isFinite(next) || next <= LOWER) {
				return OptionalDouble.empty();
			}
			if (Math.abs(next - r) < TOL) {
				return OptionalDouble.of(next);
			}
			r = next;
		}
		return OptionalDouble.empty();
	}

	static OptionalDouble bisection(double[] t, double[] a) {
		double lo = LOWER;
		double hi = 1;
		double flo = npv(t, a, lo);
		double fhi = npv(t, a, hi);
		while (Math.signum(flo) == Math.signum(fhi) && hi < 1e9) {
			hi *= 2;
			fhi = npv(t, a, hi);
		}
		if (!Double.isFinite(flo) || Math.signum(flo) == Math.signum(fhi)) {
			return OptionalDouble.empty();
		}
		for (int i = 0; i < 500 && hi - lo > TOL; i++) {
			double mid = (lo + hi) / 2;
			double fm = npv(t, a, mid);
			if (Math.signum(fm) == Math.signum(flo)) {
				lo = mid;
				flo = fm;
			} else {
				hi = mid;
			}
		}
		return OptionalDouble.of((lo + hi) / 2);
	}
}
