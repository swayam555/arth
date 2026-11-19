package in.arth.api;

import org.junit.jupiter.api.BeforeEach;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.context.annotation.Import;
import org.springframework.http.HttpStatusCode;
import org.springframework.test.context.TestPropertySource;
import org.springframework.web.client.RestClient;

@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Import(TestcontainersConfiguration.class)
@TestPropertySource(properties = {
		"arth.otp.fixed-code=246810",
		"arth.otp.resend-cooldown=0s",
		"arth.rate-limit.capacity=10000",
		"logging.structured.format.console="
})
public abstract class IntegrationTest {

	@Value("${local.server.port}")
	int port;

	protected RestClient http;

	@BeforeEach
	void setUpClient() {
		http = RestClient.builder()
				.baseUrl("http://localhost:" + port)
				.defaultStatusHandler(HttpStatusCode::isError, (req, res) -> {})
				.build();
	}
}
