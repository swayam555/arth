package in.arth.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.nio.file.Files;
import java.nio.file.Path;
import org.junit.jupiter.api.Test;

class ApiApplicationTests extends IntegrationTest {

	@Test
	void exportsOpenApiSpecForTheTypedClient() throws Exception {
		String spec = http.get().uri("/v3/api-docs").retrieve().body(String.class);
		assertThat(spec).contains("/v1/auth/otp/verify").contains("/v1/me/consents");

		String out = System.getProperty("arth.openapi.out");
		if (out != null) {
			Files.writeString(Path.of(out), spec);
		}
	}
}
