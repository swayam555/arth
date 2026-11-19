package in.arth.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.Map;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

class AuthFlowTest extends IntegrationTest {

	private static final String CODE = "246810";

	@SuppressWarnings("unchecked")
	private Map<String, Object> login(String phone) {
		assertThat(post("/v1/auth/otp/request", Map.of("phone", phone), null).getStatusCode()).isEqualTo(HttpStatus.ACCEPTED);
		ResponseEntity<Map> res = post("/v1/auth/otp/verify", Map.of("phone", phone, "code", CODE), null);
		assertThat(res.getStatusCode()).isEqualTo(HttpStatus.OK);
		return res.getBody();
	}

	private ResponseEntity<Map> post(String path, Object body, String token) {
		var spec = http.post().uri(path).body(body);
		if (token != null) {
			spec = spec.header("Authorization", "Bearer " + token);
		}
		return spec.retrieve().toEntity(Map.class);
	}

	private ResponseEntity<Map> get(String path, String token) {
		return http.get().uri(path).header("Authorization", "Bearer " + token).retrieve().toEntity(Map.class);
	}

	@Test
	void otpLoginCreatesUserAndReturnsWorkingAccessToken() {
		Map<String, Object> session = login("+919812345601");
		assertThat(((Map<?, ?>) session.get("user")).get("isNew")).isEqualTo(true);

		ResponseEntity<Map> me = get("/v1/me", (String) session.get("accessToken"));
		assertThat(me.getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(me.getBody()).containsEntry("phone", "+919812345601");

		assertThat(((Map<?, ?>) login("+919812345601").get("user")).get("isNew")).isEqualTo(false);
	}

	@Test
	void wrongCodeIsRejectedAndAttemptsAreCapped() {
		String phone = "+919812345602";
		post("/v1/auth/otp/request", Map.of("phone", phone), null);
		for (int i = 0; i < 5; i++) {
			assertThat(post("/v1/auth/otp/verify", Map.of("phone", phone, "code", "000000"), null).getStatusCode())
					.isEqualTo(HttpStatus.UNAUTHORIZED);
		}
		assertThat(post("/v1/auth/otp/verify", Map.of("phone", phone, "code", CODE), null).getStatusCode())
				.isEqualTo(HttpStatus.TOO_MANY_REQUESTS);
	}

	@Test
	void nonIndianNumbersAreRejected() {
		assertThat(post("/v1/auth/otp/request", Map.of("phone", "+14155550100"), null).getStatusCode())
				.isEqualTo(HttpStatus.BAD_REQUEST);
	}

	@Test
	void refreshRotatesAndReuseRevokesTheWholeFamily() {
		Map<String, Object> session = login("+919812345603");
		String first = (String) session.get("refreshToken");

		ResponseEntity<Map> rotated = post("/v1/auth/refresh", Map.of("refreshToken", first), null);
		assertThat(rotated.getStatusCode()).isEqualTo(HttpStatus.OK);
		String second = (String) rotated.getBody().get("refreshToken");
		assertThat(second).isNotEqualTo(first);

		ResponseEntity<Map> reuse = post("/v1/auth/refresh", Map.of("refreshToken", first), null);
		assertThat(reuse.getStatusCode()).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(reuse.getBody()).containsEntry("code", "refresh_reused");

		assertThat(post("/v1/auth/refresh", Map.of("refreshToken", second), null).getStatusCode())
				.isEqualTo(HttpStatus.UNAUTHORIZED);
	}

	@Test
	void protectedEndpointsRequireToken() {
		assertThat(http.get().uri("/v1/me").retrieve().toBodilessEntity().getStatusCode())
				.isEqualTo(HttpStatus.UNAUTHORIZED);
	}

	@Test
	void consentsAreRecordedExportedAndErasedOnDelete() {
		Map<String, Object> session = login("+919812345604");
		String token = (String) session.get("accessToken");

		ResponseEntity<Map> consents = http.put().uri("/v1/me/consents")
				.header("Authorization", "Bearer " + token)
				.body(Map.of("core", true, "ai_copilot", true))
				.retrieve().toEntity(Map.class);
		assertThat(consents.getBody()).containsEntry("core", true).containsEntry("ai_copilot", true).containsEntry("push", false);

		ResponseEntity<Map> export = get("/v1/me/export", token);
		assertThat(export.getBody()).containsKeys("user", "consents");

		assertThat(http.delete().uri("/v1/me").header("Authorization", "Bearer " + token).retrieve().toBodilessEntity()
				.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
		assertThat(get("/v1/me", token).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
	}

	@Test
	void devicesRegisterIdempotentlyAndUnregister() {
		String token = (String) login("+919812345605").get("accessToken");
		Map<String, String> device = Map.of("expoPushToken", "ExponentPushToken[it-device]", "platform", "android");
		assertThat(post("/v1/me/devices", device, token).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
		assertThat(post("/v1/me/devices", device, token).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
		assertThat((java.util.List<?>) get("/v1/me/export", token).getBody().get("devices")).hasSize(1);
		assertThat(post("/v1/me/devices/unregister", Map.of("expoPushToken", "ExponentPushToken[it-device]"), token)
				.getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);
		assertThat((java.util.List<?>) get("/v1/me/export", token).getBody().get("devices")).isEmpty();
	}
}
