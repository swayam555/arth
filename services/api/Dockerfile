# syntax=docker/dockerfile:1.7
FROM eclipse-temurin:21-jdk-alpine AS build
WORKDIR /src
COPY packages/proto/proto packages/proto/proto
COPY services/api/gradlew services/api/settings.gradle.kts services/api/build.gradle.kts services/api/gradle.properties services/api/
COPY services/api/gradle services/api/gradle
WORKDIR /src/services/api
RUN --mount=type=cache,target=/root/.gradle ./gradlew --no-daemon dependencies -q > /dev/null
COPY services/api/src src
RUN --mount=type=cache,target=/root/.gradle ./gradlew --no-daemon bootJar -x test && cp build/libs/*.jar /app.jar

FROM eclipse-temurin:21-jre-alpine
RUN addgroup -S arth && adduser -S arth -G arth
USER arth
COPY --from=build /app.jar /app/app.jar
EXPOSE 8080
ENTRYPOINT ["java", "-jar", "/app/app.jar"]
