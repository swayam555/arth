package in.arth.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;
import org.springframework.jdbc.core.simple.JdbcClient;

@SuppressWarnings({"unchecked", "rawtypes"})
class CandleApiTest extends IntegrationTest {

	private static final Instant START = Instant.parse("2026-11-18T04:00:00Z");

	@Autowired
	JdbcClient jdbc;

	private String token;

	@BeforeEach
	void seed() {
		String phone = "+9197" + (10_000_000 + (int) (Math.random() * 89_999_999));
		http.post().uri("/v1/auth/otp/request").body(Map.of("phone", phone)).retrieve().toBodilessEntity();
		token = (String) http.post().uri("/v1/auth/otp/verify").body(Map.of("phone", phone, "code", "246810")).retrieve()
				.body(Map.class).get("accessToken");
		jdbc.sql("DELETE FROM candles_1m WHERE symbol = 'INFY'").update();
		for (int i = 0; i < 10; i++) {
			jdbc.sql("INSERT INTO candles_1m (symbol, bucket, o, h, l, c, v) VALUES ('INFY', ?, ?, ?, ?, ?, ?)")
					.params(Timestamp.from(START.plusSeconds(60L * i)), 100 + i, 101 + i, 99 + i, 100.5 + i, 10 * (i + 1))
					.update();
		}
	}

	private ResponseEntity<Map> get(String path) {
		return http.get().uri(path).header("Authorization", "Bearer " + token).retrieve().toEntity(Map.class);
	}

	@Test
	void pagesOneMinuteCandlesOldestFirst() {
		Map first = get("/v1/instruments/infy/candles?tf=1m&limit=4").getBody();
		List<List<Number>> rows = (List<List<Number>>) first.get("candles");
		assertThat(rows).hasSize(4);
		assertThat(rows.getFirst().get(0).longValue()).isEqualTo(START.plusSeconds(360).toEpochMilli());
		assertThat(rows.getLast().get(4).doubleValue()).isEqualTo(109.5);
		long before = ((Number) first.get("nextBefore")).longValue();
		assertThat(before).isEqualTo(rows.getFirst().get(0).longValue());

		Map older = get("/v1/instruments/INFY/candles?tf=1m&limit=10&before=" + before).getBody();
		assertThat((List<?>) older.get("candles")).hasSize(6);
		assertThat(older.get("nextBefore")).isNull();
	}

	@Test
	void rollsUpIntoFiveMinuteBarsWithRealTimeAggregation() {
		List<List<Number>> rows = (List<List<Number>>) get("/v1/instruments/INFY/candles?tf=5m").getBody().get("candles");
		assertThat(rows).hasSize(2);
		List<Number> bar = rows.getFirst();
		assertThat(bar.get(0).longValue()).isEqualTo(START.toEpochMilli());
		assertThat(bar.subList(1, 6)).extracting(Number::doubleValue).containsExactly(100.0, 105.0, 99.0, 104.5, 150.0);
		assertThat(rows.getLast().get(5).doubleValue()).isEqualTo(400.0);
	}

	@Test
	void rejectsBadTimeframeUnknownSymbolAndAnonymousCallers() {
		assertThat(get("/v1/instruments/INFY/candles?tf=7m").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(get("/v1/instruments/INFY/candles?limit=5000").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(get("/v1/instruments?limit=500").getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(get("/v1/instruments/NOPE/candles").getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		assertThat(http.get().uri("/v1/instruments/INFY/candles").retrieve().toBodilessEntity().getStatusCode())
				.isEqualTo(HttpStatus.UNAUTHORIZED);
	}
}
