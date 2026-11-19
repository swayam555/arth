package in.arth.api.config;

import in.arth.api.ratelimit.RateLimitFilter;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.HttpMethod;
import org.springframework.security.config.Customizer;
import org.springframework.security.config.annotation.web.builders.HttpSecurity;
import org.springframework.security.config.http.SessionCreationPolicy;
import org.springframework.security.oauth2.server.resource.web.authentication.BearerTokenAuthenticationFilter;
import org.springframework.security.web.SecurityFilterChain;

@Configuration
class SecurityConfig {

	@Bean
	SecurityFilterChain api(HttpSecurity http, RateLimitFilter rateLimitFilter) throws Exception {
		return http
				.csrf(csrf -> csrf.disable())
				.sessionManagement(s -> s.sessionCreationPolicy(SessionCreationPolicy.STATELESS))
				.authorizeHttpRequests(auth -> auth
						.requestMatchers("/v1/auth/**").permitAll()
						.requestMatchers(HttpMethod.GET, "/actuator/health/**", "/actuator/prometheus").permitAll()
						.requestMatchers("/v3/api-docs/**", "/docs/**", "/swagger-ui/**").permitAll()
						.anyRequest().authenticated())
				.oauth2ResourceServer(o -> o.jwt(Customizer.withDefaults()))
				.addFilterAfter(rateLimitFilter, BearerTokenAuthenticationFilter.class)
				.build();
	}
}
