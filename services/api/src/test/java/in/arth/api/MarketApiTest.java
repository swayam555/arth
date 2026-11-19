package in.arth.api;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import java.util.Map;
import java.util.stream.IntStream;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.http.HttpMethod;
import org.springframework.http.HttpStatus;
import org.springframework.http.ResponseEntity;

@SuppressWarnings({"unchecked", "rawtypes"})
class MarketApiTest extends IntegrationTest {

	private String token;

	@BeforeEach
	void login() {
		String phone = "+9198" + (10_000_000 + (int) (Math.random() * 89_999_999));
		http.post().uri("/v1/auth/otp/request").body(Map.of("phone", phone)).retrieve().toBodilessEntity();
		Map body = http.post().uri("/v1/auth/otp/verify").body(Map.of("phone", phone, "code", "246810")).retrieve().body(Map.class);
		token = (String) body.get("accessToken");
	}

	private <T> ResponseEntity<T> call(HttpMethod method, String path, Object body, Class<T> type) {
		var spec = http.method(method).uri(path).header("Authorization", "Bearer " + token);
		if (body != null) {
			spec = spec.body(body);
		}
		return spec.retrieve().toEntity(type);
	}

	@Test
	void searchRanksExactSymbolFirstAndPaginates() {
		Map page = call(HttpMethod.GET, "/v1/instruments?q=reliance", null, Map.class).getBody();
		List<Map> items = (List<Map>) page.get("items");
		assertThat(items.getFirst()).containsEntry("symbol", "RELIANCE");

		Map browse = call(HttpMethod.GET, "/v1/instruments?limit=100", null, Map.class).getBody();
		assertThat((List<?>) browse.get("items")).hasSize(100);
		Map next = call(HttpMethod.GET, "/v1/instruments?limit=100&cursor=" + browse.get("nextCursor"), null, Map.class).getBody();
		assertThat(((List<Map>) next.get("items")).getFirst().get("symbol"))
				.isNotEqualTo(((List<Map>) browse.get("items")).getFirst().get("symbol"));

		assertThat(call(HttpMethod.GET, "/v1/instruments?cursor=garbage", null, Map.class).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
	}

	@Test
	void fuzzyNameSearchFindsInstruments() {
		List<Map> items = (List<Map>) call(HttpMethod.GET, "/v1/instruments?q=tata consul", null, Map.class).getBody().get("items");
		assertThat(items).extracting(m -> m.get("symbol")).contains("TCS");
	}

	@Test
	void instrumentDetailAnd404() {
		assertThat(call(HttpMethod.GET, "/v1/instruments/tcs", null, Map.class).getBody().get("instrument")).isNotNull();
		assertThat(call(HttpMethod.GET, "/v1/instruments/NOPE", null, Map.class).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
	}

	@Test
	void newUserGetsDefaultWatchlistAndCanEditIt() {
		List<Map> lists = call(HttpMethod.GET, "/v1/watchlists", null, List.class).getBody();
		assertThat(lists).hasSize(1);
		String id = (String) lists.getFirst().get("id");
		assertThat((List<?>) lists.getFirst().get("items")).hasSizeGreaterThanOrEqualTo(10);

		Map updated = call(HttpMethod.PUT, "/v1/watchlists/" + id + "/items", Map.of("symbols", List.of("tcs", "INFY", "TCS")), Map.class).getBody();
		assertThat((List<Map>) updated.get("items")).extracting(m -> m.get("symbol")).containsExactly("TCS", "INFY");

		ResponseEntity<Map> unknown = call(HttpMethod.PUT, "/v1/watchlists/" + id + "/items", Map.of("symbols", List.of("TCS", "ZZZZ")), Map.class);
		assertThat(unknown.getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
		assertThat(unknown.getBody()).containsEntry("code", "unknown_symbols");
	}

	@Test
	void watchlistIsCappedAt200() {
		String id = (String) ((List<Map>) call(HttpMethod.GET, "/v1/watchlists", null, List.class).getBody()).getFirst().get("id");
		List<String> symbols = ((List<Map>) call(HttpMethod.GET, "/v1/instruments?limit=100", null, Map.class).getBody().get("items"))
				.stream().map(m -> (String) m.get("symbol")).toList();
		Map page2 = call(HttpMethod.GET, "/v1/instruments?limit=100&cursor=" + call(HttpMethod.GET, "/v1/instruments?limit=100", null, Map.class).getBody().get("nextCursor"), null, Map.class).getBody();
		List<String> all = new java.util.ArrayList<>(symbols);
		((List<Map>) page2.get("items")).forEach(m -> all.add((String) m.get("symbol")));
		assertThat(call(HttpMethod.PUT, "/v1/watchlists/" + id + "/items", Map.of("symbols", all), Map.class).getStatusCode()).isEqualTo(HttpStatus.OK);
		all.add("ZOMATO");
		assertThat(call(HttpMethod.PUT, "/v1/watchlists/" + id + "/items", Map.of("symbols", all), Map.class).getStatusCode()).isEqualTo(HttpStatus.BAD_REQUEST);
	}

	@Test
	void createRenameReorderDeleteAndIsolation() {
		Map second = call(HttpMethod.POST, "/v1/watchlists", Map.of("name", "Swing"), Map.class).getBody();
		String secondId = (String) second.get("id");
		String firstId = (String) ((List<Map>) call(HttpMethod.GET, "/v1/watchlists", null, List.class).getBody()).getFirst().get("id");

		assertThat(call(HttpMethod.PATCH, "/v1/watchlists/" + secondId, Map.of("name", "Swing trades"), Map.class).getBody())
				.containsEntry("name", "Swing trades");

		List<Map> reordered = call(HttpMethod.PUT, "/v1/watchlists/order", Map.of("ids", List.of(secondId, firstId)), List.class).getBody();
		assertThat(reordered).extracting(m -> m.get("id")).containsExactly(secondId, firstId);
		assertThat(call(HttpMethod.PUT, "/v1/watchlists/order", Map.of("ids", List.of(secondId)), Map.class).getStatusCode())
				.isEqualTo(HttpStatus.BAD_REQUEST);

		String mine = token;
		login();
		assertThat(call(HttpMethod.DELETE, "/v1/watchlists/" + secondId, null, Void.class).getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
		token = mine;
		assertThat(call(HttpMethod.DELETE, "/v1/watchlists/" + secondId, null, Void.class).getStatusCode()).isEqualTo(HttpStatus.NO_CONTENT);

		IntStream.range(0, 9).forEach(i -> call(HttpMethod.POST, "/v1/watchlists", Map.of("name", "L" + i), Map.class));
		assertThat(call(HttpMethod.POST, "/v1/watchlists", Map.of("name", "overflow"), Map.class).getStatusCode()).isEqualTo(HttpStatus.CONFLICT);
	}

	@Test
	void exportIncludesWatchlists() {
		Map export = call(HttpMethod.GET, "/v1/me/export", null, Map.class).getBody();
		assertThat((List<?>) export.get("watchlists")).hasSize(1);
		assertThat((List<?>) export.get("watchlist_items")).isNotEmpty();
	}
}
