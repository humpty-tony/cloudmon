package attribution

import (
	"context"
	"crypto/tls"
	"encoding/json"
	"errors"
	"io"
	"net"
	"net/http"
	"os"
	"regexp"
	"strings"
	"time"
)

const maxHTTPBody = 2 << 20

var envPattern = regexp.MustCompile(`^[A-Za-z_][A-Za-z0-9_]{0,127}$`)

func environmentToken(d dependencies, name, def string) (string, error) {
	if name == "" {
		name = def
	}
	if !envPattern.MatchString(name) {
		return "", errors.New("invalid token environment variable name")
	}
	getenv := d.getenv
	if getenv == nil {
		getenv = os.Getenv
	}
	token := getenv(name)
	if token == "" || len(token) > 32768 || strings.ContainsAny(token, "\r\n") {
		return "", errors.New("token environment variable is unset or invalid")
	}
	return token, nil
}

// HTTPS-only, normal certificate verification, bounded reads, no redirects.
// Test transports are injected privately; no public configuration disables TLS.
func secureClient() *http.Client {
	transport := http.DefaultTransport.(*http.Transport).Clone()
	transport.TLSClientConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	transport.ResponseHeaderTimeout = 10 * time.Second
	return &http.Client{Timeout: 12 * time.Second, Transport: secureTransport{base: transport}, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

type secureTransport struct{ base http.RoundTripper }

func (t secureTransport) RoundTrip(req *http.Request) (*http.Response, error) {
	if req.URL.Scheme != "https" {
		return nil, errors.New("HTTPS is required")
	}
	resp, err := t.base.RoundTrip(req)
	if err != nil {
		return nil, errors.New("HTTPS request failed")
	}
	resp.Body = &limitedBody{ReadCloser: resp.Body, remaining: 8 << 20}
	return resp, nil
}

type limitedBody struct {
	io.ReadCloser
	remaining int64
}

func (b *limitedBody) Read(p []byte) (int, error) {
	if b.remaining <= 0 {
		return 0, errors.New("response body exceeds limit")
	}
	if int64(len(p)) > b.remaining {
		p = p[:b.remaining]
	}
	n, e := b.ReadCloser.Read(p)
	b.remaining -= int64(n)
	return n, e
}
func requestJSON(ctx context.Context, d dependencies, method, endpoint, header, token, body string, out any) error {
	req, err := http.NewRequestWithContext(ctx, method, endpoint, strings.NewReader(body))
	if err != nil {
		return errors.New("invalid source endpoint")
	}
	if req.URL.Scheme != "https" {
		ip := net.ParseIP(req.URL.Hostname())
		if !d.allowHTTP || d.http == nil || req.URL.Scheme != "http" || ip == nil || !ip.IsLoopback() {
			return errors.New("HTTPS is required")
		}
	}
	req.Header.Set(header, token)
	req.Header.Set("Accept", "application/json")
	if body != "" {
		req.Header.Set("Content-Type", "application/json")
	}
	base := d.http
	if base == nil {
		base = secureClient()
	}
	client := *base
	client.Timeout = 12 * time.Second
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }
	response, err := client.Do(req)
	if err != nil {
		return errors.New("source request failed or cancelled")
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return errors.New("source request rejected, unavailable or redirected")
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxHTTPBody+1))
	if err != nil || len(data) > maxHTTPBody {
		return errors.New("source response is unreadable or exceeds size limit")
	}
	secret := strings.TrimPrefix(token, "Bearer ")
	if secret != "" && strings.Contains(string(data), secret) {
		return errors.New("source response contains credential material")
	}
	if json.Unmarshal(data, out) != nil {
		return errors.New("source returned invalid JSON")
	}
	return nil
}
