package in.arth.api.user;

import java.util.Optional;
import java.util.UUID;
import org.springframework.jdbc.core.simple.JdbcClient;
import org.springframework.stereotype.Repository;

@Repository
public class UserRepository {

	public record User(UUID id, String phone, String name, String locale) {}

	public record Upserted(User user, boolean created) {}

	private final JdbcClient jdbc;

	UserRepository(JdbcClient jdbc) {
		this.jdbc = jdbc;
	}

	public Upserted upsertByPhone(String phone) {
		return jdbc.sql("""
				INSERT INTO users (phone_e164) VALUES (?)
				ON CONFLICT (phone_e164) DO UPDATE SET phone_e164 = excluded.phone_e164
				RETURNING id, phone_e164, name, locale, (xmax = 0) AS created""")
				.param(phone)
				.query((rs, n) -> new Upserted(
						new User(rs.getObject("id", UUID.class), rs.getString("phone_e164"), rs.getString("name"), rs.getString("locale")),
						rs.getBoolean("created")))
				.single();
	}

	public Optional<User> find(UUID id) {
		return jdbc.sql("SELECT id, phone_e164, name, locale FROM users WHERE id = ?")
				.param(id)
				.query((rs, n) -> new User(rs.getObject("id", UUID.class), rs.getString("phone_e164"), rs.getString("name"), rs.getString("locale")))
				.optional();
	}

	public void update(UUID id, String name, String locale) {
		jdbc.sql("UPDATE users SET name = coalesce(?, name), locale = coalesce(?, locale) WHERE id = ?")
				.params(name, locale, id)
				.update();
	}

	public void delete(UUID id) {
		jdbc.sql("DELETE FROM users WHERE id = ?").param(id).update();
	}
}
