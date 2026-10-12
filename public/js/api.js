/*
 * Gọi API của game. Token truy cập chỉ nằm trong bộ nhớ + sessionStorage của tab
 * (không dùng cookie vì game chạy trong iframe khác tên miền với Portal).
 */
(function (root) {
  'use strict';
  var KEY = 'hlw_access';
  var API = { token: null };

  try { API.token = sessionStorage.getItem(KEY); } catch (e) { /* bỏ qua */ }

  API.setToken = function (t) {
    API.token = t;
    try { if (t) sessionStorage.setItem(KEY, t); else sessionStorage.removeItem(KEY); } catch (e) { /* bỏ qua */ }
  };

  function ApiError(status, data) {
    this.status = status;
    this.code = (data && data.error) || 'network';
    this.message = (data && data.message) || 'Không kết nối được máy chủ, vui lòng thử lại';
    this.data = data || {};
  }

  API.call = function (method, path, body, opts) {
    opts = opts || {};
    var headers = { 'Accept': 'application/json' };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (API.token) headers.Authorization = 'Bearer ' + API.token;
    return fetch(path, {
      method: method,
      headers: headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'omit',
      cache: 'no-store',
      keepalive: !!opts.keepalive
    }).then(function (res) {
      return res.text().then(function (txt) {
        var data = null;
        try { data = txt ? JSON.parse(txt) : null; } catch (e) { data = null; }
        if (!res.ok) throw new ApiError(res.status, data);
        return data;
      });
    }, function () {
      throw new ApiError(0, null);
    });
  };

  API.get = function (p) { return API.call('GET', p); };
  API.post = function (p, b, o) { return API.call('POST', p, b || {}, o); };
  API.ApiError = ApiError;

  root.HLWApi = API;
}(window));
