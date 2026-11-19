package in.arth.api.user;

import java.util.LinkedHashMap;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import in.arth.api.common.Problems;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class ConsentService {

	public static final Set<String> PURPOSES = Set.of("core", "ai_copilot", "push", "analytics");
	public static final String CURRENT_VERSION = "2026-11";

	private final JdbcClient jdbc;

	ConsentService(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public Map<String, Boolean> current(UUID userId) {
		Map<String, Boolean> result = new LinkedHashMap<>();
		PURPOSES.stream().sorted().forEach(p -> result.put(p, false));
		jdbc.sql("""
				SELECT DISTINCT ON (purpose) purpose, granted FROM consents
				WHERE user_id = ? AND version = ? ORDER BY purpose, recorded_at DESC""")
				.params(userId, CURRENT_VERSION)
				.query((rs, n) -> Map.entry(rs.getString("purpose"), rs.getBoolean("granted")))
				.list()
				.forEach(e -> result.put(e.getKey(), e.getValue()));
		return result;
	}

	public boolean granted(UUID userId, String purpose) {
		return Boolean.TRUE.equals(current(userId).get(purpose));
	}

	@Transactional
	public Map<String, Boolean> record(UUID userId, Map<String, Boolean> decisions) {
		decisions.forEach((purpose, granted) -> {
			if (!PURPOSES.contains(purpose)) {
				throw Problems.badRequest("unknown_purpose", "Unknown consent purpose: " + purpose);
			}
			jdbc.sql("INSERT INTO consents (user_id, purpose, granted, version) VALUES (?, ?, ?, ?)")
					.params(userId, purpose, granted, CURRENT_VERSION)
					.update();
		});
		return current(userId);
	}
}
