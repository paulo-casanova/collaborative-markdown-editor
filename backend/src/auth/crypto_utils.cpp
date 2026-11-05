#include "cme/auth/crypto_utils.hpp"
#include <openssl/rand.h>
#include <openssl/evp.h>
#include <openssl/crypto.h>
#include <crypt.h>
#include <sstream>
#include <iomanip>
#include <vector>
#include <algorithm>
#include <cctype>
#include <stdexcept>

namespace cme::auth {

std::string generate_random_token(size_t bytes) {
    if (bytes == 0) return "";
    std::vector<unsigned char> buf(bytes);
    if (RAND_bytes(buf.data(), static_cast<int>(bytes)) != 1) {
        throw std::runtime_error("OpenSSL RAND_bytes failed to generate entropy");
    }

    std::ostringstream ss;
    for (unsigned char b : buf) {
        ss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(b);
    }
    return ss.str();
}

std::string sha256_hex(std::string_view input) {
    unsigned char hash[EVP_MAX_MD_SIZE];
    unsigned int length = 0;

    EVP_MD_CTX* ctx = EVP_MD_CTX_new();
    if (!ctx) {
        throw std::runtime_error("Failed to allocate EVP_MD_CTX");
    }

    if (EVP_DigestInit_ex(ctx, EVP_sha256(), nullptr) != 1 ||
        EVP_DigestUpdate(ctx, input.data(), input.size()) != 1 ||
        EVP_DigestFinal_ex(ctx, hash, &length) != 1) {
        EVP_MD_CTX_free(ctx);
        throw std::runtime_error("EVP digest operation failed");
    }
    EVP_MD_CTX_free(ctx);

    std::ostringstream ss;
    for (unsigned int i = 0; i < length; ++i) {
        ss << std::hex << std::setw(2) << std::setfill('0') << static_cast<int>(hash[i]);
    }
    return ss.str();
}

std::string hash_password_bcrypt(const std::string& password, int cost) {
    if (cost < 4 || cost > 31) {
        cost = 10;
    }
    char salt[CRYPT_GENSALT_OUTPUT_SIZE];
    char* s = crypt_gensalt_r("$2b$", static_cast<unsigned long>(cost), nullptr, 0, salt, sizeof(salt));
    if (!s) {
        throw std::runtime_error("crypt_gensalt_r failed to generate bcrypt salt");
    }

    crypt_data data{};
    char* hashed = crypt_r(password.c_str(), salt, &data);
    if (!hashed) {
        throw std::runtime_error("crypt_r failed to hash password");
    }
    return std::string(hashed);
}

bool verify_password_bcrypt(const std::string& password, const std::string& hash) {
    if (password.empty() && hash.empty()) return true;
    if (hash.empty()) return false;

    crypt_data data{};
    char* computed = crypt_r(password.c_str(), hash.c_str(), &data);
    if (!computed) {
        return false;
    }
    return hash == computed;
}

std::optional<std::string> extract_bearer_token(std::string_view auth_header) {
    // Trim leading whitespace
    while (!auth_header.empty() && std::isspace(static_cast<unsigned char>(auth_header.front()))) {
        auth_header.remove_prefix(1);
    }
    // Trim trailing whitespace
    while (!auth_header.empty() && std::isspace(static_cast<unsigned char>(auth_header.back()))) {
        auth_header.remove_suffix(1);
    }

    constexpr std::string_view prefix = "bearer ";
    if (auth_header.size() < prefix.size()) {
        return std::nullopt;
    }

    // Case-insensitive comparison for "Bearer "
    std::string candidate_prefix;
    candidate_prefix.reserve(prefix.size());
    for (size_t i = 0; i < prefix.size(); ++i) {
        candidate_prefix.push_back(static_cast<char>(std::tolower(static_cast<unsigned char>(auth_header[i]))));
    }

    if (candidate_prefix != prefix) {
        return std::nullopt;
    }

    std::string_view token = auth_header.substr(prefix.size());
    while (!token.empty() && std::isspace(static_cast<unsigned char>(token.front()))) {
        token.remove_prefix(1);
    }
    while (!token.empty() && std::isspace(static_cast<unsigned char>(token.back()))) {
        token.remove_suffix(1);
    }

    if (token.empty()) {
        return std::nullopt;
    }

    return std::string(token);
}

std::optional<std::string> extract_cookie_token(
    std::string_view cookie_header,
    std::string_view cookie_name
) {
    while (!cookie_header.empty()) {
        // Find next ';' delimiter
        size_t semi = cookie_header.find(';');
        std::string_view part = (semi == std::string_view::npos) ? cookie_header : cookie_header.substr(0, semi);

        // Advance remainder
        if (semi == std::string_view::npos) {
            cookie_header = {};
        } else {
            cookie_header.remove_prefix(semi + 1);
        }

        // Trim part
        while (!part.empty() && std::isspace(static_cast<unsigned char>(part.front()))) {
            part.remove_prefix(1);
        }
        while (!part.empty() && std::isspace(static_cast<unsigned char>(part.back()))) {
            part.remove_suffix(1);
        }

        size_t eq = part.find('=');
        if (eq != std::string_view::npos) {
            std::string_view key = part.substr(0, eq);
            std::string_view val = part.substr(eq + 1);

            // Trim key
            while (!key.empty() && std::isspace(static_cast<unsigned char>(key.back()))) {
                key.remove_suffix(1);
            }

            if (key == cookie_name) {
                // Trim val quotes if present
                if (val.size() >= 2 && val.front() == '"' && val.back() == '"') {
                    val.remove_prefix(1);
                    val.remove_suffix(1);
                }
                return std::string(val);
            }
        }
    }

    return std::nullopt;
}

bool constant_time_equals(std::string_view a, std::string_view b) noexcept {
    if (a.size() != b.size()) {
        return false;
    }
    if (a.empty()) {
        return true;
    }
    return CRYPTO_memcmp(a.data(), b.data(), a.size()) == 0;
}

std::string base64_encode(std::string_view in) {
    static const char b64[] = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    std::string out;
    int val = 0;
    int valb = -6;
    for (unsigned char c : in) {
        val = (val << 8) + c;
        valb += 8;
        while (valb >= 0) {
            out.push_back(b64[(val >> valb) & 0x3F]);
            valb -= 6;
        }
    }
    if (valb > -6) {
        out.push_back(b64[((val << 8) >> (valb + 8)) & 0x3F]);
    }
    while (out.size() % 4 != 0) {
        out.push_back('=');
    }
    return out;
}

std::optional<std::string> base64_decode(std::string_view in) {
    std::string out;
    std::vector<int> T(256, -1);
    const std::string b64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (int i = 0; i < 64; i++) {
        T[static_cast<unsigned char>(b64[i])] = i;
    }

    int val = 0;
    int valb = -8;
    for (unsigned char c : in) {
        if (std::isspace(c)) continue;
        if (c == '=') break;
        if (T[c] == -1) return std::nullopt;
        val = (val << 6) + T[c];
        valb += 6;
        if (valb >= 0) {
            out.push_back(static_cast<char>((val >> valb) & 0xFF));
            valb -= 8;
        }
    }
    return out;
}

} // namespace cme::auth
