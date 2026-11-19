package in.arth.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

@SuppressWarnings({"unchecked", "rawtypes"})
class AlertApiTest extends IntegrationTest {

	private String token;

	@BeforeEach
	void login() {
		token = loginAs("+9197" + (10_000_000 + (int) (Math.random() * 89_999_999)));
	}

	private String loginAs(String phone) {
		http.post().uri("/v1/auth/otp/request").body(Map.of("phone", phone)).retrieve().toBodilessEntity();
		return (String) http.post().uri("/v1/auth/otp/verify").body(Map.of("phone", phone, "code", "246810")).retrieve()
				.body(Map.class).get("accessToken");
	}

	private <T> ResponseEntity<T> call(String tok, HttpMethod method, String path, Object body, Class<T> type) {
		var spec = http.method(method).uri(path).header("Authorization", "Bearer " + tok);
		if (body != null) {
			spec = spec.body(body);
		}
		return spec.retrieve().toEntity(type);
	}

	@Test
	void crudIsUserScopedAndValidated() {
		ResponseEntity<Map> created = call(token, HttpMethod.POST, "/v1/alerts", Map.of("symbol", "tcs", "kind", "above", "value", 4100), Map.class);
		assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(created.getBody()).containsEntry("symbol", "TCS").containsEntry("active", true);
		String id = (String) created.getBody().get("id");

		Map paused = call(token, HttpMethod.PATCH, "/v1/alerts/" + id, Map.of("active", false), Map.class).getBody();
		assertThat(paused).containsEntry("active", false);
		assertThat(((Number) paused.get("value")).doubleValue()).isEqualTo(4100);

		String other = loginAs("+9196" + (10_000_000 + (int) (Math.random() * 89_999_999)));
		assertThat(call(other, HttpMethod.GET, "/v1/alerts", null, List.class).getBody()).isEmpty();
		assertThat(call(other, HttpMethod.DELETE, "/v1/alerts/" + id, null, Map.class).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);

		assertThat(call(token, HttpMethod.POST, "/v1/alerts", Map.of("symbol", "ZZZZ", "kind", "above", "value", 1), Map.class).getBody())
				.containsEntry("code", "unknown_symbol");
		assertThat(call(token, HttpMethod.POST, "/v1/alerts", Map.of("symbol", "TCS", "kind", "pct_move", "value", 80), Map.class).getBody())
				.containsEntry("code", "bad_value");
		assertThat(call(token, HttpMethod.POST, "/v1/alerts", Map.of("symbol", "TCS", "kind", "above", "value", -1), Map.class).getStatusCode())
				.isEqualTo(HttpStatus.BAD_REQUEST);

		assertThat(call(token, HttpMethod.DELETE, "/v1/alerts/" + id, null, Map.class).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
		assertThat(call(token, HttpMethod.GET, "/v1/alerts", null, List.class).getBody()).isEmpty();
	}

	@Test
	void activeAlertsAreCapped() {
		for (int i = 0; i < 50; i++) {
			call(token, HttpMethod.POST, "/v1/alerts", Map.of("symbol", "INFY", "kind", "below", "value", 1000 + i), Map.class);
		}
		ResponseEntity<Map> over = call(token, HttpMethod.POST, "/v1/alerts", Map.of("symbol", "INFY", "kind", "below", "value", 1), Map.class);
		assertThat(over.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(over.getBody()).containsEntry("code", "alert_limit");
	}
}
