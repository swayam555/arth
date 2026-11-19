package in.arth.api.portfolio;

import static org.assertj.core.api.Assertions.assertThat;

import in.arth.api.IntegrationTest;
import in.arth.proto.v1.PortfolioUpdated;
import java.nio.charset.StandardCharsets;
import java.time.Duration;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import java.util.UUID;
import org.apache.kafka.clients.consumer.ConsumerConfig;
import org.apache.kafka.clients.consumer.KafkaConsumer;
import org.apache.kafka.common.serialization.ByteArrayDeserializer;
import org.apache.kafka.common.serialization.StringDeserializer;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.core.io.ByteArrayResource;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.http.ResponseEntity;
import org.springframework.util.LinkedMultiValueMap;
import org.testcontainers.kafka.KafkaContainer;

@SuppressWarnings({"unchecked", "rawtypes"})
class PortfolioApiTest extends IntegrationTest {

	private static final String TRADEBOOK = """
			symbol,isin,trade_date,exchange,segment,series,trade_type,auction,quantity,price,trade_id,order_id,order_execution_time
			TCS,INETCSX00001,2025-04-01,NSE,EQ,EQ,buy,false,10,3000,1,1,2025-04-01T10:00:00
			TCS,INETCSX00001,2025-06-02,NSE,EQ,EQ,buy,false,10,3400,2,2,2025-06-02T10:00:00
			INFY,INEINFY00004,2025-05-05,NSE,EQ,EQ,buy,false,20,1500,3,3,2025-05-05T10:00:00
			INFY,INEINFY00004,2025-09-09,NSE,EQ,EQ,sell,false,5,1650,4,4,2025-09-09T10:00:00
			NIFTYBEES,INENIFT00050,2025-07-01,NSE,EQ,EQ,buy,false,100,280,5,5,2025-07-01T10:00:00
			""";

	@Autowired
	KafkaContainer kafka;

	private String token;
	private String userId;

	@BeforeEach
	void login() {
		String phone = "+9198" + (10_000_000 + (int) (Math.random() * 89_999_999));
		http.post().uri("/v1/auth/otp/request").body(Map.of("phone", phone)).retrieve().toBodilessEntity();
		Map body = http.post().uri("/v1/auth/otp/verify").body(Map.of("phone", phone, "code", "246810")).retrieve().body(Map.class);
		token = (String) body.get("accessToken");
		userId = (String) ((Map) body.get("user")).get("id");
	}

	private <T> ResponseEntity<T> call(HttpMethod method, String path, Object body, Class<T> type) {
		var spec = http.method(method).uri(path).header("Authorization", "Bearer " + token);
		if (body != null) {
			spec = spec.body(body);
		}
		return spec.retrieve().toEntity(type);
	}

	private ResponseEntity<Map> upload(String path, String filename, byte[] bytes, Map<String, String> params) {
		var form = new LinkedMultiValueMap<String, Object>();
		form.add("file", new ByteArrayResource(bytes) {
			@Override
			public String getFilename() {
				return filename;
			}
		});
		params.forEach(form::add);
		return http.post().uri(path).header("Authorization", "Bearer " + token).contentType(MediaType.MULTIPART_FORM_DATA).body(form)
				.retrieve().toEntity(Map.class);
	}

	private ResponseEntity<Map> csv(String text, boolean dryRun) {
		return upload("/v1/portfolio/import/csv", "tradebook.csv", text.getBytes(StandardCharsets.UTF_8), Map.of("dryRun", String.valueOf(dryRun)));
	}

	@Test
	void csvDryRunThenCommitBuildsHoldingsAndPublishesAnEvent() {
		try (var consumer = consumer()) {
			Map preview = csv(TRADEBOOK, true).getBody();
			assertThat(preview).containsEntry("accepted", 5).containsEntry("committed", false);
			assertThat((Map) preview.get("mapping")).containsEntry("side", "trade_type");
			assertThat(call(HttpMethod.GET, "/v1/portfolio/transactions", null, List.class).getBody()).isEmpty();

			Map done = csv(TRADEBOOK, false).getBody();
			assertThat(done).containsEntry("committed", true);
			assertThat(done.get("importId")).isNotNull();

			Map summary = call(HttpMethod.GET, "/v1/portfolio", null, Map.class).getBody();
			assertThat(summary.get("txnCount")).isEqualTo(5);
			List<Map> holdings = (List<Map>) summary.get("holdings");
			assertThat(holdings).extracting(h -> h.get("symbol")).containsExactlyInAnyOrder("TCS", "INFY", "NIFTYBEES");
			Map tcs = holdings.stream().filter(h -> "TCS".equals(h.get("symbol"))).findFirst().orElseThrow();
			assertThat(((Number) tcs.get("qty")).doubleValue()).isEqualTo(20);
			assertThat(((Number) tcs.get("avgCost")).doubleValue()).isEqualTo(3200);
			assertThat(((Number) summary.get("realized")).doubleValue()).isEqualTo(750);
			assertThat(((Number) summary.get("invested")).doubleValue()).isEqualTo(20 * 3200 + 15 * 1500 + 100 * 280);
			double weights = holdings.stream().mapToDouble(h -> ((Number) h.get("weight")).doubleValue()).sum();
			assertThat(weights).isBetween(0.999, 1.001);
			assertThat((List<Map>) ((Map) summary.get("allocation")).get("asset")).extracting(s -> s.get("key")).contains("equity", "etf");
			assertThat(summary.get("xirr")).isNotNull();

			Map history = call(HttpMethod.GET, "/v1/portfolio/history?days=30", null, Map.class).getBody();
			List<Map> points = (List<Map>) history.get("points");
			assertThat(points).hasSize(30);
			assertThat(((Number) points.getLast().get("value")).doubleValue())
					.isCloseTo(((Number) summary.get("value")).doubleValue(), org.assertj.core.data.Offset.offset(0.5));
			assertThat(call(HttpMethod.GET, "/v1/portfolio/history?days=0", null, Map.class).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

			assertThat(awaitVersions(consumer, 1)).containsExactly(1L);
		}

		ResponseEntity<Map> again = csv(TRADEBOOK, false);
		assertThat(again.getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
		assertThat(again.getBody()).containsEntry("code", "duplicate_import");
		assertThat((List<String>) csv(TRADEBOOK, true).getBody().get("warnings")).anyMatch(w -> w.contains("already imported"));

		Map export = call(HttpMethod.GET, "/v1/me/export", null, Map.class).getBody();
		assertThat((List<?>) export.get("portfolio_txns")).hasSize(5);
		assertThat((List<?>) export.get("portfolio_imports")).hasSize(1);
	}

	@Test
	void importsThatWouldOversellAreReportedAndRejected() {
		String csv = "symbol,side,qty,price,date\nSBIN,buy,1,800,2025-01-02\nSBIN,sell,3,810,2025-01-03\n";
		Map preview = csv(csv, true).getBody();
		assertThat((List<Map>) preview.get("rejected")).anyMatch(i -> String.valueOf(i.get("message")).contains("SBIN"));
		ResponseEntity<Map> commit = csv(csv, false);
		assertThat(commit.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(commit.getBody()).containsEntry("code", "oversell");
		assertThat(call(HttpMethod.GET, "/v1/portfolio/transactions", null, List.class).getBody()).isEmpty();
	}

	@Test
	void badUploadsGetStableErrorCodes() {
		assertThat(csv("", true).getBody()).containsEntry("code", "empty_file");
		assertThat(upload("/v1/portfolio/import/csv", "t.csv", "symbol\nTCS\n".getBytes(), Map.of("mapping", "{not json")).getBody())
				.containsEntry("code", "bad_mapping");
		assertThat(upload("/v1/portfolio/import/cas", "cas.pdf", CasFixtures.cdsl(), Map.of("password", "WRONG")).getBody())
				.containsEntry("code", "cas_password");
	}

	@Test
	void casImportPreviewsMaskedIdentityAndCommits() {
		Map preview = upload("/v1/portfolio/import/cas", "cas.pdf", CasFixtures.cdsl(), Map.of("password", CasFixtures.PASSWORD)).getBody();
		assertThat(preview).containsEntry("provider", "CDSL").containsEntry("pan", "ABXXXXX34F").containsEntry("accepted", 2);
		assertThat(preview.toString()).doesNotContain("ABCDE1234F").doesNotContain("ramesh.k@");
		Map done = upload("/v1/portfolio/import/cas", "cas.pdf", CasFixtures.cdsl(), Map.of("password", CasFixtures.PASSWORD, "dryRun", "false")).getBody();
		assertThat(done).containsEntry("committed", true);
		List<Map> txns = call(HttpMethod.GET, "/v1/portfolio/transactions", null, List.class).getBody();
		assertThat(txns).extracting(t -> t.get("source")).containsOnly("cas");
	}

	@Test
	void manualTransactionsAreValidatedAndEditable() {
		Map buy = Map.of("symbol", "RELIANCE", "side", "BUY", "qty", 10, "price", 2400, "tradeDate", "2025-03-03");
		ResponseEntity<Map> created = call(HttpMethod.POST, "/v1/portfolio/transactions", buy, Map.class);
		assertThat(created.getStatusCode()).isEqualTo(HttpStatus.CREATED);
		String id = (String) created.getBody().get("id");

		var sell = Map.of("symbol", "RELIANCE", "side", "SELL", "qty", 11, "price", 2500, "tradeDate", "2025-04-04");
		assertThat(call(HttpMethod.POST, "/v1/portfolio/transactions", sell, Map.class).getBody()).containsEntry("code", "oversell");
		var future = Map.of("symbol", "RELIANCE", "side", "BUY", "qty", 1, "price", 1, "tradeDate", LocalDate.now().plusDays(5).toString());
		assertThat(call(HttpMethod.POST, "/v1/portfolio/transactions", future, Map.class).getBody()).containsEntry("code", "future_date");
		var unknown = Map.of("symbol", "ZZZZ", "side", "BUY", "qty", 1, "price", 1, "tradeDate", "2025-01-01");
		assertThat(call(HttpMethod.POST, "/v1/portfolio/transactions", unknown, Map.class).getBody()).containsEntry("code", "unknown_symbol");
		var negative = Map.of("symbol", "RELIANCE", "side", "BUY", "qty", -1, "price", 1, "tradeDate", "2025-01-01");
		assertThat(call(HttpMethod.POST, "/v1/portfolio/transactions", negative, Map.class).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);

		Map edit = Map.of("symbol", "RELIANCE", "side", "BUY", "qty", 12, "price", 2400, "tradeDate", "2025-03-03");
		assertThat(call(HttpMethod.PUT, "/v1/portfolio/transactions/" + id, edit, Map.class).getStatusCode()).isEqualTo(HttpStatus.OK);
		assertThat(call(HttpMethod.POST, "/v1/portfolio/transactions", sell, Map.class).getStatusCode()).isEqualTo(HttpStatus.CREATED);
		assertThat(call(HttpMethod.DELETE, "/v1/portfolio/transactions/" + id, null, Void.class).getStatusCode())
				.isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(call(HttpMethod.DELETE, "/v1/portfolio/transactions/" + UUID.randomUUID(), null, Map.class).getStatusCode())
				.isEqualTo(HttpStatus.NOT_FOUND);

		Map summary = call(HttpMethod.GET, "/v1/portfolio", null, Map.class).getBody();
		assertThat(((Number) summary.get("version")).longValue()).isEqualTo(3);
		assertThat(((Number) summary.get("realized")).doubleValue()).isEqualTo(1100);
	}

	private KafkaConsumer<String, byte[]> consumer() {
		Properties p = new Properties();
		p.put(ConsumerConfig.BOOTSTRAP_SERVERS_CONFIG, kafka.getBootstrapServers());
		p.put(ConsumerConfig.GROUP_ID_CONFIG, "portfolio-test-" + UUID.randomUUID());
		p.put(ConsumerConfig.AUTO_OFFSET_RESET_CONFIG, "earliest");
		p.put(ConsumerConfig.KEY_DESERIALIZER_CLASS_CONFIG, StringDeserializer.class);
		p.put(ConsumerConfig.VALUE_DESERIALIZER_CLASS_CONFIG, ByteArrayDeserializer.class);
		var c = new KafkaConsumer<String, byte[]>(p);
		c.subscribe(List.of("portfolio.updated"));
		return c;
	}

	private List<Long> awaitVersions(KafkaConsumer<String, byte[]> consumer, int n) {
		List<Long> versions = new ArrayList<>();
		long deadline = System.currentTimeMillis() + 20_000;
		while (versions.size() < n && System.currentTimeMillis() < deadline) {
			for (var rec : consumer.poll(Duration.ofMillis(500))) {
				if (userId.equals(rec.key())) {
					try {
						versions.add(PortfolioUpdated.parseFrom(rec.value()).getVersion());
					} catch (com.google.protobuf.InvalidProtocolBufferException e) {
						throw new AssertionError(e);
					}
				}
			}
		}
		return versions;
	}
}
