<?php
/**
 * Fetches a public web page and returns its HTML as JSON.
 * Browsers block reading other sites directly (CORS), so the checker
 * asks this script to download the page instead.
 *
 * GET fetch.php?url=https://example.com
 * → { "url": "<final url>", "html": "<page source>" }
 */

header('Content-Type: application/json; charset=utf-8');
header('X-Content-Type-Options: nosniff');

const MAX_BYTES     = 3 * 1024 * 1024; // 3 MB
const MAX_REDIRECTS = 5;
const TIMEOUT       = 15;

function fail(int $status, string $message): void {
    http_response_code($status);
    echo json_encode(['error' => $message]);
    exit;
}

/**
 * Checks the URL and returns the public IP its host resolves to.
 * Blocks local and private addresses so the script can't be used
 * to reach machines inside your own network.
 */
function validateUrl(string $url): string {
    if (!filter_var($url, FILTER_VALIDATE_URL)) {
        fail(400, 'Enter a full URL starting with http:// or https://.');
    }
    $parts  = parse_url($url);
    $scheme = strtolower($parts['scheme'] ?? '');
    if (!in_array($scheme, ['http', 'https'], true)) {
        fail(400, 'Only http and https links can be checked.');
    }
    if (isset($parts['port']) && !in_array((int) $parts['port'], [80, 443, 8080, 8443], true)) {
        fail(400, 'That port is not allowed.');
    }

    $host = $parts['host'] ?? '';
    $ips  = filter_var($host, FILTER_VALIDATE_IP) ? [$host] : (gethostbynamel($host) ?: []);
    if (!$ips) {
        fail(400, 'Could not find that website. Check the address.');
    }
    foreach ($ips as $ip) {
        if (!filter_var($ip, FILTER_VALIDATE_IP, FILTER_FLAG_NO_PRIV_RANGE | FILTER_FLAG_NO_RES_RANGE)) {
            fail(403, 'Local and private network addresses cannot be checked.');
        }
    }
    return $ips[0];
}

$url = trim($_GET['url'] ?? '');
if ($url === '') {
    fail(400, 'No URL was given.');
}
if (!preg_match('#^https?://#i', $url)) {
    $url = 'https://' . $url;
}

for ($hop = 0; $hop <= MAX_REDIRECTS; $hop++) {
    $ip    = validateUrl($url);
    $parts = parse_url($url);
    $port  = $parts['port'] ?? (strtolower($parts['scheme']) === 'https' ? 443 : 80);

    $body = '';
    $tooBig = false;
    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_FOLLOWLOCATION => false,           // redirects are checked one by one below
        CURLOPT_RESOLVE        => ["{$parts['host']}:{$port}:{$ip}"], // use the IP we validated
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_TIMEOUT        => TIMEOUT,
        CURLOPT_USERAGENT      => 'AccessibilityChecker/1.0 (+https://github.com)',
        CURLOPT_HTTPHEADER     => ['Accept: text/html,application/xhtml+xml'],
        CURLOPT_ENCODING       => '',
        CURLOPT_HEADER         => false,
        CURLOPT_WRITEFUNCTION  => function ($ch, $chunk) use (&$body, &$tooBig) {
            $body .= $chunk;
            if (strlen($body) > MAX_BYTES) {
                $tooBig = true;
                return 0; // stop downloading
            }
            return strlen($chunk);
        },
    ]);
    curl_exec($ch);

    $status   = curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    $type     = (string) curl_getinfo($ch, CURLINFO_CONTENT_TYPE);
    $location = curl_getinfo($ch, CURLINFO_REDIRECT_URL);
    $error    = curl_error($ch);
    curl_close($ch);

    if ($tooBig) {
        fail(413, 'That page is larger than 3 MB.');
    }
    if ($error && !$status) {
        fail(502, 'Could not load the page: ' . $error);
    }
    if ($status >= 300 && $status < 400 && $location) {
        $url = $location;
        continue;
    }
    if ($status >= 400) {
        fail(502, "The website answered with an error (HTTP $status).");
    }
    if ($type && !preg_match('#text/html|application/xhtml#i', $type)) {
        fail(415, "That link is not a web page (it is $type).");
    }

    // Convert to UTF-8 so json_encode never fails on other encodings.
    if (!mb_check_encoding($body, 'UTF-8')) {
        $body = mb_convert_encoding($body, 'UTF-8', 'Windows-1252, ISO-8859-1');
    }

    echo json_encode(['url' => $url, 'html' => $body], JSON_UNESCAPED_SLASHES);
    exit;
}

fail(508, 'The page redirected too many times.');
