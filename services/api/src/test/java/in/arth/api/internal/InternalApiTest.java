package in.arth.api.internal;

import static org.assertj.core.api.Assertions.assertThat;

import com.nimbusds.jose.JWSAlgorithm;
import com.nimbusds.jose.JWSHeader;
import com.nimbusds.jose.crypto.MACSigner;
import com.nimbusds.jwt.JWTClaimsSet;
import com.nimbusds.jwt.SignedJWT;
import in.arth.api.IntegrationTest;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Date;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;

@SuppressWarnings({"unchecked", "rawtypes"})
class InternalApiTest extends IntegrationTest {

	@Value("${arth.jwt.internal-secret}")
	String internalSecret;

	private String userToken;
	private String userId;

	@BeforeEach
	void login() {
		String phone = "+9197" + (10_000_000 + (int) (Math.random() * 89_999_999));
		http.post().uri("/v1/auth/otp/request").body(Map.of("phone", phone)).retrieve().toBodilessEntity();
		Map body = http.post().uri("/v1/auth/otp/verify").body(Map.of("phone", phone, "code", "246810")).retrieve().body(Map.class);
		userToken = (String) body.get("accessToken");
		userId = (String) ((Map) body.get("user")).get("id");
	}

	private String mint(String issuer, String audience, String secret) throws Exception {
		var claims = new JWTClaimsSet.Builder().subject(userId).issuer(issuer).audience(audience)
				.issueTime(new Date()).expirationTime(Date.from(Instant.now().plusSeconds(60))).build();
		var jwt = new SignedJWT(new JWSHeader(JWSAlgorithm.HS256), claims);
		jwt.sign(new MACSigner(secret.getBytes(StandardCharsets.UTF_8)));
		return jwt.serialize();
	}

	private HttpStatus status(String path, String token) {
		return (HttpStatus) http.get().uri(path).header("Authorization", "Bearer " + token).retrieve().toBodilessEntity().getStatusCode();
	}

	@Test
	void servesTheTokenSubjectsPortfolioWithAServiceToken() throws Exception {
		http.post().uri("/v1/portfolio/transactions").header("Authorization", "Bearer " + userToken)
				.body(Map.of("symbol", "TCS", "side", "BUY", "qty", 5, "price", 3000, "tradeDate", "2025-04-01"))
				.retrieve().toBodilessEntity();
		String service = mint("arth-ai", "arth-internal", internalSecret);
		Map summary = http.get().uri("/internal/v1/portfolio").header("Authorization", "Bearer " + service).retrieve().body(Map.class);
		assertThat((List) summary.get("holdings")).hasSize(1);
		Map consents = http.get().uri("/internal/v1/consents").header("Authorization", "Bearer " + service).retrieve().body(Map.class);
		assertThat(consents).containsKey("ai_copilot");
		Map closes = http.get().uri("/internal/v1/instruments/tcs/closes?days=30").header("Authorization", "Bearer " + service)
				.retrieve().body(Map.class);
		assertThat(closes.get("symbol")).isEqualTo("TCS");
	}

	@Test
	void rejectsUserTokensAndWrongAudienceOrSecret() throws Exception {
		assertThat(status("/internal/v1/portfolio", userToken)).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(status("/internal/v1/portfolio", mint("arth-ai", "someone-else", internalSecret))).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(status("/internal/v1/portfolio", mint("arth-api", "arth-internal", internalSecret))).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(status("/v1/portfolio", mint("arth-ai", "arth-internal", internalSecret))).isEqualTo(HttpStatus.UNAUTHORIZED);
		assertThat(status("/internal/v1/portfolio", "garbage")).isEqualTo(HttpStatus.UNAUTHORIZED);
	}
}
