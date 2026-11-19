package in.arth.api.user;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Component;

/** DPDP right to access: every user-owned table, as stored. */
@Component
class UserDataExporter {

	private static final List<String> USER_TABLES = List.of("devices", "consents", "watchlists", "alerts", "portfolio_txns", "portfolio_imports", "portfolio_versions");

	private final JdbcClient jdbc;

	UserDataExporter(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	Map<String, Object> export(UUID userId) {
		Map<String, Object> out = new LinkedHashMap<>();
		out.put("user", jdbc.sql("SELECT id, phone_e164, name, locale, created_at FROM users WHERE id = ?")
				.param(userId).query().singleRow());
		for (String table : USER_TABLES) {
			out.put(table, jdbc.sql("SELECT * FROM " + table + " WHERE user_id = ?").param(userId).query().listOfRows());
		}
		out.put("watchlist_items", jdbc.sql("""
				SELECT wi.* FROM watchlist_items wi JOIN watchlists w ON w.id = wi.watchlist_id
				WHERE w.user_id = ? ORDER BY wi.watchlist_id, wi.position""").param(userId).query().listOfRows());
		return out;
	}
}
