package in.arth.api.common;

import com.google.protobuf.MessageLite;
import org.springframework.kafka.core.KafkaTemplate;
import org.springframework.stereotype.Component;

@Component
public class Events {

	public static final String PORTFOLIO_UPDATED = "portfolio.updated";
	public static final String USER_DELETED = "user.deleted";

	private final KafkaTemplate<String, byte[]> kafka;

	Events(KafkaTemplate<String, byte[]> kafka) {
		this.kafka = kafka;
	}

	public void publish(String topic, String key, MessageLite message) {
		kafka.send(topic, key, message.toByteArray());
	}
}
