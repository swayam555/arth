package in.arth.api.config;

import com.nimbusds.jose.jwk.source.ImmutableSecret;
import java.nio.charset.StandardCharsets;
import javax.crypto.SecretKey;
import javax.crypto.spec.SecretKeySpec;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.security.oauth2.jwt.JwtEncoder;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.jwt.NimbusJwtEncoder;

@Configuration
class JwtConfig {

	private final SecretKey userKey;

	JwtConfig(ArthProperties props) {
		this.userKey = hmacKey(props.jwt().secret());
	}

	@Bean
	JwtEncoder jwtEncoder() {
		return new NimbusJwtEncoder(new ImmutableSecret<>(userKey));
	}

	@Bean
	JwtDecoder jwtDecoder(ArthProperties props) {
		NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(userKey).macAlgorithm(MacAlgorithm.HS256).build();
		decoder.setJwtValidator(JwtValidators.createDefaultWithIssuer(props.jwt().issuer()));
		return decoder;
	}

	static SecretKey hmacKey(String secret) {
		byte[] bytes = secret.getBytes(StandardCharsets.UTF_8);
		if (bytes.length < 32) {
			throw new IllegalStateException("JWT secret must be at least 32 bytes");
		}
		return new SecretKeySpec(bytes, "HmacSHA256");
	}
}
