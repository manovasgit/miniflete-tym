<?php
// Puente entre el formulario de la web (Forminator) y el servidor de Reparto/Unidades.
// Forminator no acepta la respuesta de Google Apps Script (responde con una redirección),
// así que el webhook apunta acá: esto reenvía el pedido tal cual y le contesta 200 a Forminator.
// No guarda nada ni tiene claves: la clave viaja en la dirección (?pedido_web=...) y la
// valida el servidor de Apps Script.

header('Content-Type: application/json; charset=utf-8');
header('Cache-Control: no-store');

$DESTINO = 'https://script.google.com/macros/s/AKfycbxSI3kAU_zSf5pPXB_FWcoFwTMZ-0FUD4eCUSyRQ-B4JIXFGf2Hb4f6Ty170N8ZOp5sAA/exec';

$clave = isset($_GET['pedido_web']) ? preg_replace('/[^A-Za-z0-9]/', '', $_GET['pedido_web']) : '';
if ($clave === '' || strlen($clave) < 20) {
  http_response_code(403);
  echo '{"ok":false,"error":"Falta la clave"}';
  exit;
}

$cuerpo = file_get_contents('php://input');
$tipo = isset($_SERVER['CONTENT_TYPE']) ? $_SERVER['CONTENT_TYPE'] : '';
// Si vino como formulario (no JSON), se pasa a JSON para que el servidor lo lea igual
if ($cuerpo === '' || stripos($tipo, 'json') === false) {
  $datos = $_POST;
  if (empty($datos) && $cuerpo !== '') parse_str($cuerpo, $datos);
  $cuerpo = json_encode($datos, JSON_UNESCAPED_UNICODE);
}
// Forminator manda los campos como date_1, name_1…; el servidor los espera como date-1, name-1…
$dec = json_decode($cuerpo, true);
if (is_array($dec)) {
  $norm = array();
  foreach ($dec as $k => $v) {
    $k2 = preg_match('/^(date|select|name|textarea|text|phone|hidden|email|number|radio|checkbox|address)_\d+$/', $k) ? str_replace('_', '-', $k) : $k;
    $norm[$k2] = $v;
  }
  $cuerpo = json_encode($norm, JSON_UNESCAPED_UNICODE);
}
if (strlen($cuerpo) > 200000) {
  http_response_code(413);
  echo '{"ok":false,"error":"Pedido demasiado grande"}';
  exit;
}

set_error_handler(function ($n, $msg) { throw new ErrorException($msg, 0, $n); });
try {
$url = $DESTINO . '?pedido_web=' . $clave;
$codigo = 0;
$respuesta = '';

if (function_exists('curl_init')) {
  $ch = curl_init($url);
  curl_setopt_array($ch, array(
    CURLOPT_POST => true,
    CURLOPT_POSTFIELDS => $cuerpo,
    CURLOPT_HTTPHEADER => array('Content-Type: application/json'),
    CURLOPT_RETURNTRANSFER => true,
    // Apps Script procesa el pedido y después redirige a la respuesta: se sigue con GET
    CURLOPT_FOLLOWLOCATION => true,
    CURLOPT_TIMEOUT => 25,
  ));
  $respuesta = curl_exec($ch);
  $codigo = curl_getinfo($ch, CURLINFO_HTTP_CODE);
  curl_close($ch);
} else {
  $ctx = stream_context_create(array('http' => array(
    'method' => 'POST', 'header' => "Content-Type: application/json\r\n",
    'content' => $cuerpo, 'timeout' => 25, 'follow_location' => 1, 'ignore_errors' => true,
  )));
  $respuesta = @file_get_contents($url, false, $ctx);
  if (isset($http_response_header[0]) && preg_match('/\s(\d{3})\s/', $http_response_header[0], $m)) $codigo = (int)$m[1];
}

$json = json_decode((string)$respuesta, true);
if (is_array($json)) {
  // La clave equivocada sí se le informa a Forminator; el resto de los casos (incluida la
  // prueba de conexión de Forminator, que viene sin datos) responde 200.
  if (isset($json['error']) && $json['error'] === 'Clave inválida') http_response_code(403);
  echo json_encode($json, JSON_UNESCAPED_UNICODE);
} else {
  http_response_code($codigo >= 200 && $codigo < 400 ? 200 : 502);
  echo json_encode(array('ok' => $codigo >= 200 && $codigo < 400, 'codigo' => $codigo));
}
} catch (Throwable $e) {
  http_response_code(502);
  echo json_encode(array('ok' => false, 'error' => 'Puente: ' . $e->getMessage()));
}
