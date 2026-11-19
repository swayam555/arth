package in.arth.api.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.core.annotation.Order;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.core.DelegatingOAuth2TokenValidator;
import org.springframework.security.oauth2.core.OAuth2TokenValidatorResult;
import org.springframework.security.oauth2.jose.jws.MacAlgorithm;
import org.springframework.security.oauth2.jwt.JwtValidators;
import org.springframework.security.oauth2.jwt.NimbusJwtDecoder;
import org.springframework.security.oauth2.core.OAuth2Error;
import org.springframework.security.web.SecurityFilterChain;

/**
 * Service-to-service chain for {@code /internal/**}. Tokens are minted by the ai service with a separate secret, issuer
 * {@code arth-ai}, audience {@code arth-internal}, and the end user's id as subject, so every internal call stays user-scoped.
 */
@Configuration
class InternalSecurityConfig {

	static final String ISSUER = "arth-ai";
	static final String AUDIENCE = "arth-internal";

	@Bean
	@Order(1)
	SecurityFilterChain internal(HttpSecurity http, ArthProperties props) throws Exception {
		NimbusJwtDecoder decoder = NimbusJwtDecoder.withSecretKey(JwtConfig.hmacKey(props.jwt().internalSecret()))
				.macAlgorithm(MacAlgorithm.HS256).build();
		decoder.setJwtValidator(new DelegatingOAuth2TokenValidator<>(
				JwtValidators.createDefaultWithIssuer(ISSUER),
				jwt -> jwt.getAudience() != null && jwt.getAudience().contains(AUDIENCE)
						? OAuth2TokenValidatorResult.success()
						: OAuth2TokenValidatorResult.failure(new OAuth2Error("invalid_token", "wrong audience", null))));
		return http
				.securityMatcher("/internal/**")
				.csrf(csrf -> csrf.disable())
				.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
				.authorizeHttpRequests(auth -> auth.anyRequest().authenticated())
				.oauth2ResourceServer(o -> o.jwt(j -> j.decoder(decoder)))
				.build();
	}
}
