(function e(t,n,r){function s(o,u){if(!n[o]){if(!t[o]){var a=typeof require=="function"&&require;if(!u&&a)return a(o,!0);if(i)return i(o,!0);var f=new Error("Cannot find module '"+o+"'");throw f.code="MODULE_NOT_FOUND",f}var l=n[o]={exports:{}};t[o][0].call(l.exports,function(e){var n=t[o][1][e];return s(n?n:e)},l,l.exports,e,t,n,r)}return n[o].exports}var i=typeof require=="function"&&require;for(var o=0;o<r.length;o++)s(r[o]);return s})({1:[function(require,module,exports){
module.exports = require('./lib/axios');
},{"./lib/axios":3}],2:[function(require,module,exports){
'use strict';

/*global ActiveXObject:true*/

var defaults = require('./../defaults');
var utils = require('./../utils');
var buildUrl = require('./../helpers/buildUrl');
var parseHeaders = require('./../helpers/parseHeaders');
var transformData = require('./../helpers/transformData');

module.exports = function xhrAdapter(resolve, reject, config) {
  // Transform request data
  var data = transformData(
    config.data,
    config.headers,
    config.transformRequest
  );

  // Merge headers
  var requestHeaders = utils.merge(
    defaults.headers.common,
    defaults.headers[config.method] || {},
    config.headers || {}
  );

  if (utils.isFormData(data)) {
    delete requestHeaders['Content-Type']; // Let the browser set it
  }

  // Create the request
  var request = new (XMLHttpRequest || ActiveXObject)('Microsoft.XMLHTTP');
  request.open(config.method.toUpperCase(), buildUrl(config.url, config.params), true);

  // Set the request timeout in MS
  request.timeout = config.timeout;

  // Listen for ready state
  request.onreadystatechange = function () {
    if (request && request.readyState === 4) {
      // Prepare the response
      var responseHeaders = parseHeaders(request.getAllResponseHeaders());
      var responseData = ['text', ''].indexOf(config.responseType || '') !== -1 ? request.responseText : request.response;
      var response = {
        data: transformData(
          responseData,
          responseHeaders,
          config.transformResponse
        ),
        status: request.status,
        statusText: request.statusText,
        headers: responseHeaders,
        config: config
      };

      // Resolve or reject the Promise based on the status
      (request.status >= 200 && request.status < 300 ?
        resolve :
        reject)(response);

      // Clean up request
      request = null;
    }
  };

  // Add xsrf header
  // This is only done if running in a standard browser environment.
  // Specifically not if we're in a web worker, or react-native.
  if (utils.isStandardBrowserEnv()) {
    var cookies = require('./../helpers/cookies');
    var urlIsSameOrigin = require('./../helpers/urlIsSameOrigin');

    // Add xsrf header
    var xsrfValue = urlIsSameOrigin(config.url) ?
        cookies.read(config.xsrfCookieName || defaults.xsrfCookieName) :
        undefined;

    if (xsrfValue) {
      requestHeaders[config.xsrfHeaderName || defaults.xsrfHeaderName] = xsrfValue;
    }
  }

  // Add headers to the request
  utils.forEach(requestHeaders, function (val, key) {
    // Remove Content-Type if data is undefined
    if (!data && key.toLowerCase() === 'content-type') {
      delete requestHeaders[key];
    }
    // Otherwise add header to the request
    else {
      request.setRequestHeader(key, val);
    }
  });

  // Add withCredentials to request if needed
  if (config.withCredentials) {
    request.withCredentials = true;
  }

  // Add responseType to request if needed
  if (config.responseType) {
    try {
      request.responseType = config.responseType;
    } catch (e) {
      if (request.responseType !== 'json') {
        throw e;
      }
    }
  }

  if (utils.isArrayBuffer(data)) {
    data = new DataView(data);
  }

  // Send the request
  request.send(data);
};

},{"./../defaults":6,"./../helpers/buildUrl":7,"./../helpers/cookies":8,"./../helpers/parseHeaders":9,"./../helpers/transformData":11,"./../helpers/urlIsSameOrigin":12,"./../utils":13}],3:[function(require,module,exports){
'use strict';

var defaults = require('./defaults');
var utils = require('./utils');
var dispatchRequest = require('./core/dispatchRequest');
var InterceptorManager = require('./core/InterceptorManager');

var axios = module.exports = function (config) {
  // Allow for axios('example/url'[, config]) a la fetch API
  if (typeof config === 'string') {
    config = utils.merge({
      url: arguments[0]
    }, arguments[1]);
  }

  config = utils.merge({
    method: 'get',
    headers: {},
    timeout: defaults.timeout,
    transformRequest: defaults.transformRequest,
    transformResponse: defaults.transformResponse
  }, config);

  // Don't allow overriding defaults.withCredentials
  config.withCredentials = config.withCredentials || defaults.withCredentials;

  // Hook up interceptors middleware
  var chain = [dispatchRequest, undefined];
  var promise = Promise.resolve(config);

  axios.interceptors.request.forEach(function (interceptor) {
    chain.unshift(interceptor.fulfilled, interceptor.rejected);
  });

  axios.interceptors.response.forEach(function (interceptor) {
    chain.push(interceptor.fulfilled, interceptor.rejected);
  });

  while (chain.length) {
    promise = promise.then(chain.shift(), chain.shift());
  }

  return promise;
};

// Expose defaults
axios.defaults = defaults;

// Expose all/spread
axios.all = function (promises) {
  return Promise.all(promises);
};
axios.spread = require('./helpers/spread');

// Expose interceptors
axios.interceptors = {
  request: new InterceptorManager(),
  response: new InterceptorManager()
};

// Provide aliases for supported request methods
(function () {
  function createShortMethods() {
    utils.forEach(arguments, function (method) {
      axios[method] = function (url, config) {
        return axios(utils.merge(config || {}, {
          method: method,
          url: url
        }));
      };
    });
  }

  function createShortMethodsWithData() {
    utils.forEach(arguments, function (method) {
      axios[method] = function (url, data, config) {
        return axios(utils.merge(config || {}, {
          method: method,
          url: url,
          data: data
        }));
      };
    });
  }

  createShortMethods('delete', 'get', 'head');
  createShortMethodsWithData('post', 'put', 'patch');
})();

},{"./core/InterceptorManager":4,"./core/dispatchRequest":5,"./defaults":6,"./helpers/spread":10,"./utils":13}],4:[function(require,module,exports){
'use strict';

var utils = require('./../utils');

function InterceptorManager() {
  this.handlers = [];
}

/**
 * Add a new interceptor to the stack
 *
 * @param {Function} fulfilled The function to handle `then` for a `Promise`
 * @param {Function} rejected The function to handle `reject` for a `Promise`
 *
 * @return {Number} An ID used to remove interceptor later
 */
InterceptorManager.prototype.use = function (fulfilled, rejected) {
  this.handlers.push({
    fulfilled: fulfilled,
    rejected: rejected
  });
  return this.handlers.length - 1;
};

/**
 * Remove an interceptor from the stack
 *
 * @param {Number} id The ID that was returned by `use`
 */
InterceptorManager.prototype.eject = function (id) {
  if (this.handlers[id]) {
    this.handlers[id] = null;
  }
};

/**
 * Iterate over all the registered interceptors
 *
 * This method is particularly useful for skipping over any
 * interceptors that may have become `null` calling `remove`.
 *
 * @param {Function} fn The function to call for each interceptor
 */
InterceptorManager.prototype.forEach = function (fn) {
  utils.forEach(this.handlers, function (h) {
    if (h !== null) {
      fn(h);
    }
  });
};

module.exports = InterceptorManager;

},{"./../utils":13}],5:[function(require,module,exports){
(function (process){
'use strict';

/**
 * Dispatch a request to the server using whichever adapter
 * is supported by the current environment.
 *
 * @param {object} config The config that is to be used for the request
 * @returns {Promise} The Promise to be fulfilled
 */
module.exports = function dispatchRequest(config) {
  return new Promise(function (resolve, reject) {
    try {
      // For browsers use XHR adapter
      if ((typeof XMLHttpRequest !== 'undefined') || (typeof ActiveXObject !== 'undefined')) {
        require('../adapters/xhr')(resolve, reject, config);
      }
      // For node use HTTP adapter
      else if (typeof process !== 'undefined') {
        require('../adapters/http')(resolve, reject, config);
      }
    } catch (e) {
      reject(e);
    }
  });
};


}).call(this,require('_process'))

},{"../adapters/http":2,"../adapters/xhr":2,"_process":19}],6:[function(require,module,exports){
'use strict';

var utils = require('./utils');

var PROTECTION_PREFIX = /^\)\]\}',?\n/;
var DEFAULT_CONTENT_TYPE = {
  'Content-Type': 'application/x-www-form-urlencoded'
};

module.exports = {
  transformRequest: [function (data, headers) {
    if(utils.isFormData(data)) {
      return data;
    }
    if (utils.isArrayBuffer(data)) {
      return data;
    }
    if (utils.isArrayBufferView(data)) {
      return data.buffer;
    }
    if (utils.isObject(data) && !utils.isFile(data) && !utils.isBlob(data)) {
      // Set application/json if no Content-Type has been specified
      if (!utils.isUndefined(headers)) {
        utils.forEach(headers, function (val, key) {
          if (key.toLowerCase() === 'content-type') {
            headers['Content-Type'] = val;
          }
        });

        if (utils.isUndefined(headers['Content-Type'])) {
          headers['Content-Type'] = 'application/json;charset=utf-8';
        }
      }
      return JSON.stringify(data);
    }
    return data;
  }],

  transformResponse: [function (data) {
    if (typeof data === 'string') {
      data = data.replace(PROTECTION_PREFIX, '');
      try {
        data = JSON.parse(data);
      } catch (e) { /* Ignore */ }
    }
    return data;
  }],

  headers: {
    common: {
      'Accept': 'application/json, text/plain, */*'
    },
    patch: utils.merge(DEFAULT_CONTENT_TYPE),
    post: utils.merge(DEFAULT_CONTENT_TYPE),
    put: utils.merge(DEFAULT_CONTENT_TYPE)
  },

  timeout: 0,

  xsrfCookieName: 'XSRF-TOKEN',
  xsrfHeaderName: 'X-XSRF-TOKEN'
};

},{"./utils":13}],7:[function(require,module,exports){
'use strict';

var utils = require('./../utils');

function encode(val) {
  return encodeURIComponent(val).
    replace(/%40/gi, '@').
    replace(/%3A/gi, ':').
    replace(/%24/g, '$').
    replace(/%2C/gi, ',').
    replace(/%20/g, '+').
    replace(/%5B/gi, '[').
    replace(/%5D/gi, ']');
}

/**
 * Build a URL by appending params to the end
 *
 * @param {string} url The base of the url (e.g., http://www.google.com)
 * @param {object} [params] The params to be appended
 * @returns {string} The formatted url
 */
module.exports = function buildUrl(url, params) {
  if (!params) {
    return url;
  }

  var parts = [];

  utils.forEach(params, function (val, key) {
    if (val === null || typeof val === 'undefined') {
      return;
    }

    if (utils.isArray(val)) {
      key = key + '[]';
    }

    if (!utils.isArray(val)) {
      val = [val];
    }

    utils.forEach(val, function (v) {
      if (utils.isDate(v)) {
        v = v.toISOString();
      }
      else if (utils.isObject(v)) {
        v = JSON.stringify(v);
      }
      parts.push(encode(key) + '=' + encode(v));
    });
  });

  if (parts.length > 0) {
    url += (url.indexOf('?') === -1 ? '?' : '&') + parts.join('&');
  }

  return url;
};

},{"./../utils":13}],8:[function(require,module,exports){
'use strict';

/**
 * WARNING:
 *  This file makes references to objects that aren't safe in all environments.
 *  Please see lib/utils.isStandardBrowserEnv before including this file.
 */

var utils = require('./../utils');

module.exports = {
  write: function write(name, value, expires, path, domain, secure) {
    var cookie = [];
    cookie.push(name + '=' + encodeURIComponent(value));

    if (utils.isNumber(expires)) {
      cookie.push('expires=' + new Date(expires).toGMTString());
    }

    if (utils.isString(path)) {
      cookie.push('path=' + path);
    }

    if (utils.isString(domain)) {
      cookie.push('domain=' + domain);
    }

    if (secure === true) {
      cookie.push('secure');
    }

    document.cookie = cookie.join('; ');
  },

  read: function read(name) {
    var match = document.cookie.match(new RegExp('(^|;\\s*)(' + name + ')=([^;]*)'));
    return (match ? decodeURIComponent(match[3]) : null);
  },

  remove: function remove(name) {
    this.write(name, '', Date.now() - 86400000);
  }
};

},{"./../utils":13}],9:[function(require,module,exports){
'use strict';

var utils = require('./../utils');

/**
 * Parse headers into an object
 *
 * ```
 * Date: Wed, 27 Aug 2014 08:58:49 GMT
 * Content-Type: application/json
 * Connection: keep-alive
 * Transfer-Encoding: chunked
 * ```
 *
 * @param {String} headers Headers needing to be parsed
 * @returns {Object} Headers parsed into an object
 */
module.exports = function parseHeaders(headers) {
  var parsed = {}, key, val, i;

  if (!headers) { return parsed; }

  utils.forEach(headers.split('\n'), function(line) {
    i = line.indexOf(':');
    key = utils.trim(line.substr(0, i)).toLowerCase();
    val = utils.trim(line.substr(i + 1));

    if (key) {
      parsed[key] = parsed[key] ? parsed[key] + ', ' + val : val;
    }
  });

  return parsed;
};

},{"./../utils":13}],10:[function(require,module,exports){
'use strict';

/**
 * Syntactic sugar for invoking a function and expanding an array for arguments.
 *
 * Common use case would be to use `Function.prototype.apply`.
 *
 *  ```js
 *  function f(x, y, z) {}
 *  var args = [1, 2, 3];
 *  f.apply(null, args);
 *  ```
 *
 * With `spread` this example can be re-written.
 *
 *  ```js
 *  spread(function(x, y, z) {})([1, 2, 3]);
 *  ```
 *
 * @param {Function} callback
 * @returns {Function}
 */
module.exports = function spread(callback) {
  return function (arr) {
    return callback.apply(null, arr);
  };
};

},{}],11:[function(require,module,exports){
'use strict';

var utils = require('./../utils');

/**
 * Transform the data for a request or a response
 *
 * @param {Object|String} data The data to be transformed
 * @param {Array} headers The headers for the request or response
 * @param {Array|Function} fns A single function or Array of functions
 * @returns {*} The resulting transformed data
 */
module.exports = function transformData(data, headers, fns) {
  utils.forEach(fns, function (fn) {
    data = fn(data, headers);
  });

  return data;
};

},{"./../utils":13}],12:[function(require,module,exports){
'use strict';

/**
 * WARNING:
 *  This file makes references to objects that aren't safe in all environments.
 *  Please see lib/utils.isStandardBrowserEnv before including this file.
 */

var utils = require('./../utils');
var msie = /(msie|trident)/i.test(navigator.userAgent);
var urlParsingNode = document.createElement('a');
var originUrl;

/**
 * Parse a URL to discover it's components
 *
 * @param {String} url The URL to be parsed
 * @returns {Object}
 */
function urlResolve(url) {
  var href = url;

  if (msie) {
    // IE needs attribute set twice to normalize properties
    urlParsingNode.setAttribute('href', href);
    href = urlParsingNode.href;
  }

  urlParsingNode.setAttribute('href', href);

  // urlParsingNode provides the UrlUtils interface - http://url.spec.whatwg.org/#urlutils
  return {
    href: urlParsingNode.href,
    protocol: urlParsingNode.protocol ? urlParsingNode.protocol.replace(/:$/, '') : '',
    host: urlParsingNode.host,
    search: urlParsingNode.search ? urlParsingNode.search.replace(/^\?/, '') : '',
    hash: urlParsingNode.hash ? urlParsingNode.hash.replace(/^#/, '') : '',
    hostname: urlParsingNode.hostname,
    port: urlParsingNode.port,
    pathname: (urlParsingNode.pathname.charAt(0) === '/') ?
              urlParsingNode.pathname :
              '/' + urlParsingNode.pathname
  };
}

originUrl = urlResolve(window.location.href);

/**
 * Determine if a URL shares the same origin as the current location
 *
 * @param {String} requestUrl The URL to test
 * @returns {boolean} True if URL shares the same origin, otherwise false
 */
module.exports = function urlIsSameOrigin(requestUrl) {
  var parsed = (utils.isString(requestUrl)) ? urlResolve(requestUrl) : requestUrl;
  return (parsed.protocol === originUrl.protocol &&
        parsed.host === originUrl.host);
};

},{"./../utils":13}],13:[function(require,module,exports){
'use strict';

/*global toString:true*/

// utils is a library of generic helper functions non-specific to axios

var toString = Object.prototype.toString;

/**
 * Determine if a value is an Array
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an Array, otherwise false
 */
function isArray(val) {
  return toString.call(val) === '[object Array]';
}

/**
 * Determine if a value is an ArrayBuffer
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an ArrayBuffer, otherwise false
 */
function isArrayBuffer(val) {
  return toString.call(val) === '[object ArrayBuffer]';
}

/**
 * Determine if a value is a FormData
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an FormData, otherwise false
 */
function isFormData(val) {
  return toString.call(val) === '[object FormData]';
}

/**
 * Determine if a value is a view on an ArrayBuffer
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a view on an ArrayBuffer, otherwise false
 */
function isArrayBufferView(val) {
  if ((typeof ArrayBuffer !== 'undefined') && (ArrayBuffer.isView)) {
    return ArrayBuffer.isView(val);
  } else {
    return (val) && (val.buffer) && (val.buffer instanceof ArrayBuffer);
  }
}

/**
 * Determine if a value is a String
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a String, otherwise false
 */
function isString(val) {
  return typeof val === 'string';
}

/**
 * Determine if a value is a Number
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a Number, otherwise false
 */
function isNumber(val) {
  return typeof val === 'number';
}

/**
 * Determine if a value is undefined
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if the value is undefined, otherwise false
 */
function isUndefined(val) {
  return typeof val === 'undefined';
}

/**
 * Determine if a value is an Object
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an Object, otherwise false
 */
function isObject(val) {
  return val !== null && typeof val === 'object';
}

/**
 * Determine if a value is a Date
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a Date, otherwise false
 */
function isDate(val) {
  return toString.call(val) === '[object Date]';
}

/**
 * Determine if a value is a File
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a File, otherwise false
 */
function isFile(val) {
  return toString.call(val) === '[object File]';
}

/**
 * Determine if a value is a Blob
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is a Blob, otherwise false
 */
function isBlob(val) {
  return toString.call(val) === '[object Blob]';
}

/**
 * Trim excess whitespace off the beginning and end of a string
 *
 * @param {String} str The String to trim
 * @returns {String} The String freed of excess whitespace
 */
function trim(str) {
  return str.replace(/^\s*/, '').replace(/\s*$/, '');
}

/**
 * Determine if a value is an Arguments object
 *
 * @param {Object} val The value to test
 * @returns {boolean} True if value is an Arguments object, otherwise false
 */
function isArguments(val) {
  return toString.call(val) === '[object Arguments]';
}

/**
 * Determine if we're running in a standard browser environment
 *
 * This allows axios to run in a web worker, and react-native.
 * Both environments support XMLHttpRequest, but not fully standard globals.
 *
 * web workers:
 *  typeof window -> undefined
 *  typeof document -> undefined
 *
 * react-native:
 *  typeof document.createelement -> undefined
 */
function isStandardBrowserEnv() {
  return (
    typeof window !== 'undefined' &&
    typeof document !== 'undefined' &&
    typeof document.createElement === 'function'
  );
}

/**
 * Iterate over an Array or an Object invoking a function for each item.
 *
 * If `obj` is an Array or arguments callback will be called passing
 * the value, index, and complete array for each item.
 *
 * If 'obj' is an Object callback will be called passing
 * the value, key, and complete object for each property.
 *
 * @param {Object|Array} obj The object to iterate
 * @param {Function} fn The callback to invoke for each item
 */
function forEach(obj, fn) {
  // Don't bother if no value provided
  if (obj === null || typeof obj === 'undefined') {
    return;
  }

  // Check if obj is array-like
  var isArrayLike = isArray(obj) || isArguments(obj);

  // Force an array if not already something iterable
  if (typeof obj !== 'object' && !isArrayLike) {
    obj = [obj];
  }

  // Iterate over array values
  if (isArrayLike) {
    for (var i = 0, l = obj.length; i < l; i++) {
      fn.call(null, obj[i], i, obj);
    }
  }
  // Iterate over object keys
  else {
    for (var key in obj) {
      if (obj.hasOwnProperty(key)) {
        fn.call(null, obj[key], key, obj);
      }
    }
  }
}

/**
 * Accepts varargs expecting each argument to be an object, then
 * immutably merges the properties of each object and returns result.
 *
 * When multiple objects contain the same key the later object in
 * the arguments list will take precedence.
 *
 * Example:
 *
 * ```js
 * var result = merge({foo: 123}, {foo: 456});
 * console.log(result.foo); // outputs 456
 * ```
 *
 * @param {Object} obj1 Object to merge
 * @returns {Object} Result of all merge properties
 */
function merge(/*obj1, obj2, obj3, ...*/) {
  var result = {};
  forEach(arguments, function (obj) {
    forEach(obj, function (val, key) {
      result[key] = val;
    });
  });
  return result;
}

module.exports = {
  isArray: isArray,
  isArrayBuffer: isArrayBuffer,
  isFormData: isFormData,
  isArrayBufferView: isArrayBufferView,
  isString: isString,
  isNumber: isNumber,
  isObject: isObject,
  isUndefined: isUndefined,
  isDate: isDate,
  isFile: isFile,
  isBlob: isBlob,
  isStandardBrowserEnv: isStandardBrowserEnv,
  forEach: forEach,
  merge: merge,
  trim: trim
};

},{}],14:[function(require,module,exports){
(function (global){
/*!
 * The buffer module from node.js, for the browser.
 *
 * @author   Feross Aboukhadijeh <feross@feross.org> <http://feross.org>
 * @license  MIT
 */
/* eslint-disable no-proto */

var base64 = require('base64-js')
var ieee754 = require('ieee754')
var isArray = require('is-array')

exports.Buffer = Buffer
exports.SlowBuffer = SlowBuffer
exports.INSPECT_MAX_BYTES = 50
Buffer.poolSize = 8192 // not used by this implementation

var rootParent = {}

/**
 * If `Buffer.TYPED_ARRAY_SUPPORT`:
 *   === true    Use Uint8Array implementation (fastest)
 *   === false   Use Object implementation (most compatible, even IE6)
 *
 * Browsers that support typed arrays are IE 10+, Firefox 4+, Chrome 7+, Safari 5.1+,
 * Opera 11.6+, iOS 4.2+.
 *
 * Due to various browser bugs, sometimes the Object implementation will be used even
 * when the browser supports typed arrays.
 *
 * Note:
 *
 *   - Firefox 4-29 lacks support for adding new properties to `Uint8Array` instances,
 *     See: https://bugzilla.mozilla.org/show_bug.cgi?id=695438.
 *
 *   - Safari 5-7 lacks support for changing the `Object.prototype.constructor` property
 *     on objects.
 *
 *   - Chrome 9-10 is missing the `TypedArray.prototype.subarray` function.
 *
 *   - IE10 has a broken `TypedArray.prototype.subarray` function which returns arrays of
 *     incorrect length in some situations.

 * We detect these buggy browsers and set `Buffer.TYPED_ARRAY_SUPPORT` to `false` so they
 * get the Object implementation, which is slower but behaves correctly.
 */
Buffer.TYPED_ARRAY_SUPPORT = global.TYPED_ARRAY_SUPPORT !== undefined
  ? global.TYPED_ARRAY_SUPPORT
  : (function () {
      function Bar () {}
      try {
        var arr = new Uint8Array(1)
        arr.foo = function () { return 42 }
        arr.constructor = Bar
        return arr.foo() === 42 && // typed array instances can be augmented
            arr.constructor === Bar && // constructor can be set
            typeof arr.subarray === 'function' && // chrome 9-10 lack `subarray`
            arr.subarray(1, 1).byteLength === 0 // ie10 has broken `subarray`
      } catch (e) {
        return false
      }
    })()

function kMaxLength () {
  return Buffer.TYPED_ARRAY_SUPPORT
    ? 0x7fffffff
    : 0x3fffffff
}

/**
 * Class: Buffer
 * =============
 *
 * The Buffer constructor returns instances of `Uint8Array` that are augmented
 * with function properties for all the node `Buffer` API functions. We use
 * `Uint8Array` so that square bracket notation works as expected -- it returns
 * a single octet.
 *
 * By augmenting the instances, we can avoid modifying the `Uint8Array`
 * prototype.
 */
function Buffer (arg) {
  if (!(this instanceof Buffer)) {
    // Avoid going through an ArgumentsAdaptorTrampoline in the common case.
    if (arguments.length > 1) return new Buffer(arg, arguments[1])
    return new Buffer(arg)
  }

  this.length = 0
  this.parent = undefined

  // Common case.
  if (typeof arg === 'number') {
    return fromNumber(this, arg)
  }

  // Slightly less common case.
  if (typeof arg === 'string') {
    return fromString(this, arg, arguments.length > 1 ? arguments[1] : 'utf8')
  }

  // Unusual.
  return fromObject(this, arg)
}

function fromNumber (that, length) {
  that = allocate(that, length < 0 ? 0 : checked(length) | 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) {
    for (var i = 0; i < length; i++) {
      that[i] = 0
    }
  }
  return that
}

function fromString (that, string, encoding) {
  if (typeof encoding !== 'string' || encoding === '') encoding = 'utf8'

  // Assumption: byteLength() return value is always < kMaxLength.
  var length = byteLength(string, encoding) | 0
  that = allocate(that, length)

  that.write(string, encoding)
  return that
}

function fromObject (that, object) {
  if (Buffer.isBuffer(object)) return fromBuffer(that, object)

  if (isArray(object)) return fromArray(that, object)

  if (object == null) {
    throw new TypeError('must start with number, buffer, array or string')
  }

  if (typeof ArrayBuffer !== 'undefined') {
    if (object.buffer instanceof ArrayBuffer) {
      return fromTypedArray(that, object)
    }
    if (object instanceof ArrayBuffer) {
      return fromArrayBuffer(that, object)
    }
  }

  if (object.length) return fromArrayLike(that, object)

  return fromJsonObject(that, object)
}

function fromBuffer (that, buffer) {
  var length = checked(buffer.length) | 0
  that = allocate(that, length)
  buffer.copy(that, 0, 0, length)
  return that
}

function fromArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Duplicate of fromArray() to keep fromArray() monomorphic.
function fromTypedArray (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  // Truncating the elements is probably not what people expect from typed
  // arrays with BYTES_PER_ELEMENT > 1 but it's compatible with the behavior
  // of the old Buffer constructor.
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

function fromArrayBuffer (that, array) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    array.byteLength
    that = Buffer._augment(new Uint8Array(array))
  } else {
    // Fallback: Return an object instance of the Buffer class
    that = fromTypedArray(that, new Uint8Array(array))
  }
  return that
}

function fromArrayLike (that, array) {
  var length = checked(array.length) | 0
  that = allocate(that, length)
  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

// Deserialize { type: 'Buffer', data: [1,2,3,...] } into a Buffer object.
// Returns a zero-length buffer for inputs that don't conform to the spec.
function fromJsonObject (that, object) {
  var array
  var length = 0

  if (object.type === 'Buffer' && isArray(object.data)) {
    array = object.data
    length = checked(array.length) | 0
  }
  that = allocate(that, length)

  for (var i = 0; i < length; i += 1) {
    that[i] = array[i] & 255
  }
  return that
}

if (Buffer.TYPED_ARRAY_SUPPORT) {
  Buffer.prototype.__proto__ = Uint8Array.prototype
  Buffer.__proto__ = Uint8Array
}

function allocate (that, length) {
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    // Return an augmented `Uint8Array` instance, for best performance
    that = Buffer._augment(new Uint8Array(length))
    that.__proto__ = Buffer.prototype
  } else {
    // Fallback: Return an object instance of the Buffer class
    that.length = length
    that._isBuffer = true
  }

  var fromPool = length !== 0 && length <= Buffer.poolSize >>> 1
  if (fromPool) that.parent = rootParent

  return that
}

function checked (length) {
  // Note: cannot use `length < kMaxLength` here because that fails when
  // length is NaN (which is otherwise coerced to zero.)
  if (length >= kMaxLength()) {
    throw new RangeError('Attempt to allocate Buffer larger than maximum ' +
                         'size: 0x' + kMaxLength().toString(16) + ' bytes')
  }
  return length | 0
}

function SlowBuffer (subject, encoding) {
  if (!(this instanceof SlowBuffer)) return new SlowBuffer(subject, encoding)

  var buf = new Buffer(subject, encoding)
  delete buf.parent
  return buf
}

Buffer.isBuffer = function isBuffer (b) {
  return !!(b != null && b._isBuffer)
}

Buffer.compare = function compare (a, b) {
  if (!Buffer.isBuffer(a) || !Buffer.isBuffer(b)) {
    throw new TypeError('Arguments must be Buffers')
  }

  if (a === b) return 0

  var x = a.length
  var y = b.length

  var i = 0
  var len = Math.min(x, y)
  while (i < len) {
    if (a[i] !== b[i]) break

    ++i
  }

  if (i !== len) {
    x = a[i]
    y = b[i]
  }

  if (x < y) return -1
  if (y < x) return 1
  return 0
}

Buffer.isEncoding = function isEncoding (encoding) {
  switch (String(encoding).toLowerCase()) {
    case 'hex':
    case 'utf8':
    case 'utf-8':
    case 'ascii':
    case 'binary':
    case 'base64':
    case 'raw':
    case 'ucs2':
    case 'ucs-2':
    case 'utf16le':
    case 'utf-16le':
      return true
    default:
      return false
  }
}

Buffer.concat = function concat (list, length) {
  if (!isArray(list)) throw new TypeError('list argument must be an Array of Buffers.')

  if (list.length === 0) {
    return new Buffer(0)
  }

  var i
  if (length === undefined) {
    length = 0
    for (i = 0; i < list.length; i++) {
      length += list[i].length
    }
  }

  var buf = new Buffer(length)
  var pos = 0
  for (i = 0; i < list.length; i++) {
    var item = list[i]
    item.copy(buf, pos)
    pos += item.length
  }
  return buf
}

function byteLength (string, encoding) {
  if (typeof string !== 'string') string = '' + string

  var len = string.length
  if (len === 0) return 0

  // Use a for loop to avoid recursion
  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'ascii':
      case 'binary':
      // Deprecated
      case 'raw':
      case 'raws':
        return len
      case 'utf8':
      case 'utf-8':
        return utf8ToBytes(string).length
      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return len * 2
      case 'hex':
        return len >>> 1
      case 'base64':
        return base64ToBytes(string).length
      default:
        if (loweredCase) return utf8ToBytes(string).length // assume utf8
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}
Buffer.byteLength = byteLength

// pre-set for values that may exist in the future
Buffer.prototype.length = undefined
Buffer.prototype.parent = undefined

function slowToString (encoding, start, end) {
  var loweredCase = false

  start = start | 0
  end = end === undefined || end === Infinity ? this.length : end | 0

  if (!encoding) encoding = 'utf8'
  if (start < 0) start = 0
  if (end > this.length) end = this.length
  if (end <= start) return ''

  while (true) {
    switch (encoding) {
      case 'hex':
        return hexSlice(this, start, end)

      case 'utf8':
      case 'utf-8':
        return utf8Slice(this, start, end)

      case 'ascii':
        return asciiSlice(this, start, end)

      case 'binary':
        return binarySlice(this, start, end)

      case 'base64':
        return base64Slice(this, start, end)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return utf16leSlice(this, start, end)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = (encoding + '').toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toString = function toString () {
  var length = this.length | 0
  if (length === 0) return ''
  if (arguments.length === 0) return utf8Slice(this, 0, length)
  return slowToString.apply(this, arguments)
}

Buffer.prototype.equals = function equals (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return true
  return Buffer.compare(this, b) === 0
}

Buffer.prototype.inspect = function inspect () {
  var str = ''
  var max = exports.INSPECT_MAX_BYTES
  if (this.length > 0) {
    str = this.toString('hex', 0, max).match(/.{2}/g).join(' ')
    if (this.length > max) str += ' ... '
  }
  return '<Buffer ' + str + '>'
}

Buffer.prototype.compare = function compare (b) {
  if (!Buffer.isBuffer(b)) throw new TypeError('Argument must be a Buffer')
  if (this === b) return 0
  return Buffer.compare(this, b)
}

Buffer.prototype.indexOf = function indexOf (val, byteOffset) {
  if (byteOffset > 0x7fffffff) byteOffset = 0x7fffffff
  else if (byteOffset < -0x80000000) byteOffset = -0x80000000
  byteOffset >>= 0

  if (this.length === 0) return -1
  if (byteOffset >= this.length) return -1

  // Negative offsets start from the end of the buffer
  if (byteOffset < 0) byteOffset = Math.max(this.length + byteOffset, 0)

  if (typeof val === 'string') {
    if (val.length === 0) return -1 // special case: looking for empty string always fails
    return String.prototype.indexOf.call(this, val, byteOffset)
  }
  if (Buffer.isBuffer(val)) {
    return arrayIndexOf(this, val, byteOffset)
  }
  if (typeof val === 'number') {
    if (Buffer.TYPED_ARRAY_SUPPORT && Uint8Array.prototype.indexOf === 'function') {
      return Uint8Array.prototype.indexOf.call(this, val, byteOffset)
    }
    return arrayIndexOf(this, [ val ], byteOffset)
  }

  function arrayIndexOf (arr, val, byteOffset) {
    var foundIndex = -1
    for (var i = 0; byteOffset + i < arr.length; i++) {
      if (arr[byteOffset + i] === val[foundIndex === -1 ? 0 : i - foundIndex]) {
        if (foundIndex === -1) foundIndex = i
        if (i - foundIndex + 1 === val.length) return byteOffset + foundIndex
      } else {
        foundIndex = -1
      }
    }
    return -1
  }

  throw new TypeError('val must be string, number or Buffer')
}

// `get` is deprecated
Buffer.prototype.get = function get (offset) {
  console.log('.get() is deprecated. Access using array indexes instead.')
  return this.readUInt8(offset)
}

// `set` is deprecated
Buffer.prototype.set = function set (v, offset) {
  console.log('.set() is deprecated. Access using array indexes instead.')
  return this.writeUInt8(v, offset)
}

function hexWrite (buf, string, offset, length) {
  offset = Number(offset) || 0
  var remaining = buf.length - offset
  if (!length) {
    length = remaining
  } else {
    length = Number(length)
    if (length > remaining) {
      length = remaining
    }
  }

  // must be an even number of digits
  var strLen = string.length
  if (strLen % 2 !== 0) throw new Error('Invalid hex string')

  if (length > strLen / 2) {
    length = strLen / 2
  }
  for (var i = 0; i < length; i++) {
    var parsed = parseInt(string.substr(i * 2, 2), 16)
    if (isNaN(parsed)) throw new Error('Invalid hex string')
    buf[offset + i] = parsed
  }
  return i
}

function utf8Write (buf, string, offset, length) {
  return blitBuffer(utf8ToBytes(string, buf.length - offset), buf, offset, length)
}

function asciiWrite (buf, string, offset, length) {
  return blitBuffer(asciiToBytes(string), buf, offset, length)
}

function binaryWrite (buf, string, offset, length) {
  return asciiWrite(buf, string, offset, length)
}

function base64Write (buf, string, offset, length) {
  return blitBuffer(base64ToBytes(string), buf, offset, length)
}

function ucs2Write (buf, string, offset, length) {
  return blitBuffer(utf16leToBytes(string, buf.length - offset), buf, offset, length)
}

Buffer.prototype.write = function write (string, offset, length, encoding) {
  // Buffer#write(string)
  if (offset === undefined) {
    encoding = 'utf8'
    length = this.length
    offset = 0
  // Buffer#write(string, encoding)
  } else if (length === undefined && typeof offset === 'string') {
    encoding = offset
    length = this.length
    offset = 0
  // Buffer#write(string, offset[, length][, encoding])
  } else if (isFinite(offset)) {
    offset = offset | 0
    if (isFinite(length)) {
      length = length | 0
      if (encoding === undefined) encoding = 'utf8'
    } else {
      encoding = length
      length = undefined
    }
  // legacy write(string, encoding, offset, length) - remove in v0.13
  } else {
    var swap = encoding
    encoding = offset
    offset = length | 0
    length = swap
  }

  var remaining = this.length - offset
  if (length === undefined || length > remaining) length = remaining

  if ((string.length > 0 && (length < 0 || offset < 0)) || offset > this.length) {
    throw new RangeError('attempt to write outside buffer bounds')
  }

  if (!encoding) encoding = 'utf8'

  var loweredCase = false
  for (;;) {
    switch (encoding) {
      case 'hex':
        return hexWrite(this, string, offset, length)

      case 'utf8':
      case 'utf-8':
        return utf8Write(this, string, offset, length)

      case 'ascii':
        return asciiWrite(this, string, offset, length)

      case 'binary':
        return binaryWrite(this, string, offset, length)

      case 'base64':
        // Warning: maxLength not taken into account in base64Write
        return base64Write(this, string, offset, length)

      case 'ucs2':
      case 'ucs-2':
      case 'utf16le':
      case 'utf-16le':
        return ucs2Write(this, string, offset, length)

      default:
        if (loweredCase) throw new TypeError('Unknown encoding: ' + encoding)
        encoding = ('' + encoding).toLowerCase()
        loweredCase = true
    }
  }
}

Buffer.prototype.toJSON = function toJSON () {
  return {
    type: 'Buffer',
    data: Array.prototype.slice.call(this._arr || this, 0)
  }
}

function base64Slice (buf, start, end) {
  if (start === 0 && end === buf.length) {
    return base64.fromByteArray(buf)
  } else {
    return base64.fromByteArray(buf.slice(start, end))
  }
}

function utf8Slice (buf, start, end) {
  end = Math.min(buf.length, end)
  var res = []

  var i = start
  while (i < end) {
    var firstByte = buf[i]
    var codePoint = null
    var bytesPerSequence = (firstByte > 0xEF) ? 4
      : (firstByte > 0xDF) ? 3
      : (firstByte > 0xBF) ? 2
      : 1

    if (i + bytesPerSequence <= end) {
      var secondByte, thirdByte, fourthByte, tempCodePoint

      switch (bytesPerSequence) {
        case 1:
          if (firstByte < 0x80) {
            codePoint = firstByte
          }
          break
        case 2:
          secondByte = buf[i + 1]
          if ((secondByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0x1F) << 0x6 | (secondByte & 0x3F)
            if (tempCodePoint > 0x7F) {
              codePoint = tempCodePoint
            }
          }
          break
        case 3:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0xC | (secondByte & 0x3F) << 0x6 | (thirdByte & 0x3F)
            if (tempCodePoint > 0x7FF && (tempCodePoint < 0xD800 || tempCodePoint > 0xDFFF)) {
              codePoint = tempCodePoint
            }
          }
          break
        case 4:
          secondByte = buf[i + 1]
          thirdByte = buf[i + 2]
          fourthByte = buf[i + 3]
          if ((secondByte & 0xC0) === 0x80 && (thirdByte & 0xC0) === 0x80 && (fourthByte & 0xC0) === 0x80) {
            tempCodePoint = (firstByte & 0xF) << 0x12 | (secondByte & 0x3F) << 0xC | (thirdByte & 0x3F) << 0x6 | (fourthByte & 0x3F)
            if (tempCodePoint > 0xFFFF && tempCodePoint < 0x110000) {
              codePoint = tempCodePoint
            }
          }
      }
    }

    if (codePoint === null) {
      // we did not generate a valid codePoint so insert a
      // replacement char (U+FFFD) and advance only 1 byte
      codePoint = 0xFFFD
      bytesPerSequence = 1
    } else if (codePoint > 0xFFFF) {
      // encode to utf16 (surrogate pair dance)
      codePoint -= 0x10000
      res.push(codePoint >>> 10 & 0x3FF | 0xD800)
      codePoint = 0xDC00 | codePoint & 0x3FF
    }

    res.push(codePoint)
    i += bytesPerSequence
  }

  return decodeCodePointsArray(res)
}

// Based on http://stackoverflow.com/a/22747272/680742, the browser with
// the lowest limit is Chrome, with 0x10000 args.
// We go 1 magnitude less, for safety
var MAX_ARGUMENTS_LENGTH = 0x1000

function decodeCodePointsArray (codePoints) {
  var len = codePoints.length
  if (len <= MAX_ARGUMENTS_LENGTH) {
    return String.fromCharCode.apply(String, codePoints) // avoid extra slice()
  }

  // Decode in chunks to avoid "call stack size exceeded".
  var res = ''
  var i = 0
  while (i < len) {
    res += String.fromCharCode.apply(
      String,
      codePoints.slice(i, i += MAX_ARGUMENTS_LENGTH)
    )
  }
  return res
}

function asciiSlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i] & 0x7F)
  }
  return ret
}

function binarySlice (buf, start, end) {
  var ret = ''
  end = Math.min(buf.length, end)

  for (var i = start; i < end; i++) {
    ret += String.fromCharCode(buf[i])
  }
  return ret
}

function hexSlice (buf, start, end) {
  var len = buf.length

  if (!start || start < 0) start = 0
  if (!end || end < 0 || end > len) end = len

  var out = ''
  for (var i = start; i < end; i++) {
    out += toHex(buf[i])
  }
  return out
}

function utf16leSlice (buf, start, end) {
  var bytes = buf.slice(start, end)
  var res = ''
  for (var i = 0; i < bytes.length; i += 2) {
    res += String.fromCharCode(bytes[i] + bytes[i + 1] * 256)
  }
  return res
}

Buffer.prototype.slice = function slice (start, end) {
  var len = this.length
  start = ~~start
  end = end === undefined ? len : ~~end

  if (start < 0) {
    start += len
    if (start < 0) start = 0
  } else if (start > len) {
    start = len
  }

  if (end < 0) {
    end += len
    if (end < 0) end = 0
  } else if (end > len) {
    end = len
  }

  if (end < start) end = start

  var newBuf
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    newBuf = Buffer._augment(this.subarray(start, end))
  } else {
    var sliceLen = end - start
    newBuf = new Buffer(sliceLen, undefined)
    for (var i = 0; i < sliceLen; i++) {
      newBuf[i] = this[i + start]
    }
  }

  if (newBuf.length) newBuf.parent = this.parent || this

  return newBuf
}

/*
 * Need to make sure that buffer isn't trying to write out of bounds.
 */
function checkOffset (offset, ext, length) {
  if ((offset % 1) !== 0 || offset < 0) throw new RangeError('offset is not uint')
  if (offset + ext > length) throw new RangeError('Trying to access beyond buffer length')
}

Buffer.prototype.readUIntLE = function readUIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }

  return val
}

Buffer.prototype.readUIntBE = function readUIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) {
    checkOffset(offset, byteLength, this.length)
  }

  var val = this[offset + --byteLength]
  var mul = 1
  while (byteLength > 0 && (mul *= 0x100)) {
    val += this[offset + --byteLength] * mul
  }

  return val
}

Buffer.prototype.readUInt8 = function readUInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  return this[offset]
}

Buffer.prototype.readUInt16LE = function readUInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return this[offset] | (this[offset + 1] << 8)
}

Buffer.prototype.readUInt16BE = function readUInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  return (this[offset] << 8) | this[offset + 1]
}

Buffer.prototype.readUInt32LE = function readUInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return ((this[offset]) |
      (this[offset + 1] << 8) |
      (this[offset + 2] << 16)) +
      (this[offset + 3] * 0x1000000)
}

Buffer.prototype.readUInt32BE = function readUInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] * 0x1000000) +
    ((this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    this[offset + 3])
}

Buffer.prototype.readIntLE = function readIntLE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var val = this[offset]
  var mul = 1
  var i = 0
  while (++i < byteLength && (mul *= 0x100)) {
    val += this[offset + i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readIntBE = function readIntBE (offset, byteLength, noAssert) {
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkOffset(offset, byteLength, this.length)

  var i = byteLength
  var mul = 1
  var val = this[offset + --i]
  while (i > 0 && (mul *= 0x100)) {
    val += this[offset + --i] * mul
  }
  mul *= 0x80

  if (val >= mul) val -= Math.pow(2, 8 * byteLength)

  return val
}

Buffer.prototype.readInt8 = function readInt8 (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 1, this.length)
  if (!(this[offset] & 0x80)) return (this[offset])
  return ((0xff - this[offset] + 1) * -1)
}

Buffer.prototype.readInt16LE = function readInt16LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset] | (this[offset + 1] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt16BE = function readInt16BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 2, this.length)
  var val = this[offset + 1] | (this[offset] << 8)
  return (val & 0x8000) ? val | 0xFFFF0000 : val
}

Buffer.prototype.readInt32LE = function readInt32LE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset]) |
    (this[offset + 1] << 8) |
    (this[offset + 2] << 16) |
    (this[offset + 3] << 24)
}

Buffer.prototype.readInt32BE = function readInt32BE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)

  return (this[offset] << 24) |
    (this[offset + 1] << 16) |
    (this[offset + 2] << 8) |
    (this[offset + 3])
}

Buffer.prototype.readFloatLE = function readFloatLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, true, 23, 4)
}

Buffer.prototype.readFloatBE = function readFloatBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 4, this.length)
  return ieee754.read(this, offset, false, 23, 4)
}

Buffer.prototype.readDoubleLE = function readDoubleLE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, true, 52, 8)
}

Buffer.prototype.readDoubleBE = function readDoubleBE (offset, noAssert) {
  if (!noAssert) checkOffset(offset, 8, this.length)
  return ieee754.read(this, offset, false, 52, 8)
}

function checkInt (buf, value, offset, ext, max, min) {
  if (!Buffer.isBuffer(buf)) throw new TypeError('buffer must be a Buffer instance')
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
}

Buffer.prototype.writeUIntLE = function writeUIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var mul = 1
  var i = 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUIntBE = function writeUIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  byteLength = byteLength | 0
  if (!noAssert) checkInt(this, value, offset, byteLength, Math.pow(2, 8 * byteLength), 0)

  var i = byteLength - 1
  var mul = 1
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = (value / mul) & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeUInt8 = function writeUInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0xff, 0)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  this[offset] = value
  return offset + 1
}

function objectWriteUInt16 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 2); i < j; i++) {
    buf[offset + i] = (value & (0xff << (8 * (littleEndian ? i : 1 - i)))) >>>
      (littleEndian ? i : 1 - i) * 8
  }
}

Buffer.prototype.writeUInt16LE = function writeUInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeUInt16BE = function writeUInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0xffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

function objectWriteUInt32 (buf, value, offset, littleEndian) {
  if (value < 0) value = 0xffffffff + value + 1
  for (var i = 0, j = Math.min(buf.length - offset, 4); i < j; i++) {
    buf[offset + i] = (value >>> (littleEndian ? i : 3 - i) * 8) & 0xff
  }
}

Buffer.prototype.writeUInt32LE = function writeUInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset + 3] = (value >>> 24)
    this[offset + 2] = (value >>> 16)
    this[offset + 1] = (value >>> 8)
    this[offset] = value
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeUInt32BE = function writeUInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0xffffffff, 0)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

Buffer.prototype.writeIntLE = function writeIntLE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = 0
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset] = value & 0xFF
  while (++i < byteLength && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeIntBE = function writeIntBE (value, offset, byteLength, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) {
    var limit = Math.pow(2, 8 * byteLength - 1)

    checkInt(this, value, offset, byteLength, limit - 1, -limit)
  }

  var i = byteLength - 1
  var mul = 1
  var sub = value < 0 ? 1 : 0
  this[offset + i] = value & 0xFF
  while (--i >= 0 && (mul *= 0x100)) {
    this[offset + i] = ((value / mul) >> 0) - sub & 0xFF
  }

  return offset + byteLength
}

Buffer.prototype.writeInt8 = function writeInt8 (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 1, 0x7f, -0x80)
  if (!Buffer.TYPED_ARRAY_SUPPORT) value = Math.floor(value)
  if (value < 0) value = 0xff + value + 1
  this[offset] = value
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
  } else {
    objectWriteUInt16(this, value, offset, true)
  }
  return offset + 2
}

Buffer.prototype.writeInt16BE = function writeInt16BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 8)
    this[offset + 1] = value
  } else {
    objectWriteUInt16(this, value, offset, false)
  }
  return offset + 2
}

Buffer.prototype.writeInt32LE = function writeInt32LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = value
    this[offset + 1] = (value >>> 8)
    this[offset + 2] = (value >>> 16)
    this[offset + 3] = (value >>> 24)
  } else {
    objectWriteUInt32(this, value, offset, true)
  }
  return offset + 4
}

Buffer.prototype.writeInt32BE = function writeInt32BE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 4, 0x7fffffff, -0x80000000)
  if (value < 0) value = 0xffffffff + value + 1
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value >>> 24)
    this[offset + 1] = (value >>> 16)
    this[offset + 2] = (value >>> 8)
    this[offset + 3] = value
  } else {
    objectWriteUInt32(this, value, offset, false)
  }
  return offset + 4
}

function checkIEEE754 (buf, value, offset, ext, max, min) {
  if (value > max || value < min) throw new RangeError('value is out of bounds')
  if (offset + ext > buf.length) throw new RangeError('index out of range')
  if (offset < 0) throw new RangeError('index out of range')
}

function writeFloat (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 4, 3.4028234663852886e+38, -3.4028234663852886e+38)
  }
  ieee754.write(buf, value, offset, littleEndian, 23, 4)
  return offset + 4
}

Buffer.prototype.writeFloatLE = function writeFloatLE (value, offset, noAssert) {
  return writeFloat(this, value, offset, true, noAssert)
}

Buffer.prototype.writeFloatBE = function writeFloatBE (value, offset, noAssert) {
  return writeFloat(this, value, offset, false, noAssert)
}

function writeDouble (buf, value, offset, littleEndian, noAssert) {
  if (!noAssert) {
    checkIEEE754(buf, value, offset, 8, 1.7976931348623157E+308, -1.7976931348623157E+308)
  }
  ieee754.write(buf, value, offset, littleEndian, 52, 8)
  return offset + 8
}

Buffer.prototype.writeDoubleLE = function writeDoubleLE (value, offset, noAssert) {
  return writeDouble(this, value, offset, true, noAssert)
}

Buffer.prototype.writeDoubleBE = function writeDoubleBE (value, offset, noAssert) {
  return writeDouble(this, value, offset, false, noAssert)
}

// copy(targetBuffer, targetStart=0, sourceStart=0, sourceEnd=buffer.length)
Buffer.prototype.copy = function copy (target, targetStart, start, end) {
  if (!start) start = 0
  if (!end && end !== 0) end = this.length
  if (targetStart >= target.length) targetStart = target.length
  if (!targetStart) targetStart = 0
  if (end > 0 && end < start) end = start

  // Copy 0 bytes; we're done
  if (end === start) return 0
  if (target.length === 0 || this.length === 0) return 0

  // Fatal error conditions
  if (targetStart < 0) {
    throw new RangeError('targetStart out of bounds')
  }
  if (start < 0 || start >= this.length) throw new RangeError('sourceStart out of bounds')
  if (end < 0) throw new RangeError('sourceEnd out of bounds')

  // Are we oob?
  if (end > this.length) end = this.length
  if (target.length - targetStart < end - start) {
    end = target.length - targetStart + start
  }

  var len = end - start
  var i

  if (this === target && start < targetStart && targetStart < end) {
    // descending copy from end
    for (i = len - 1; i >= 0; i--) {
      target[i + targetStart] = this[i + start]
    }
  } else if (len < 1000 || !Buffer.TYPED_ARRAY_SUPPORT) {
    // ascending copy from start
    for (i = 0; i < len; i++) {
      target[i + targetStart] = this[i + start]
    }
  } else {
    target._set(this.subarray(start, start + len), targetStart)
  }

  return len
}

// fill(value, start=0, end=buffer.length)
Buffer.prototype.fill = function fill (value, start, end) {
  if (!value) value = 0
  if (!start) start = 0
  if (!end) end = this.length

  if (end < start) throw new RangeError('end < start')

  // Fill 0 bytes; we're done
  if (end === start) return
  if (this.length === 0) return

  if (start < 0 || start >= this.length) throw new RangeError('start out of bounds')
  if (end < 0 || end > this.length) throw new RangeError('end out of bounds')

  var i
  if (typeof value === 'number') {
    for (i = start; i < end; i++) {
      this[i] = value
    }
  } else {
    var bytes = utf8ToBytes(value.toString())
    var len = bytes.length
    for (i = start; i < end; i++) {
      this[i] = bytes[i % len]
    }
  }

  return this
}

/**
 * Creates a new `ArrayBuffer` with the *copied* memory of the buffer instance.
 * Added in Node 0.12. Only available in browsers that support ArrayBuffer.
 */
Buffer.prototype.toArrayBuffer = function toArrayBuffer () {
  if (typeof Uint8Array !== 'undefined') {
    if (Buffer.TYPED_ARRAY_SUPPORT) {
      return (new Buffer(this)).buffer
    } else {
      var buf = new Uint8Array(this.length)
      for (var i = 0, len = buf.length; i < len; i += 1) {
        buf[i] = this[i]
      }
      return buf.buffer
    }
  } else {
    throw new TypeError('Buffer.toArrayBuffer not supported in this browser')
  }
}

// HELPER FUNCTIONS
// ================

var BP = Buffer.prototype

/**
 * Augment a Uint8Array *instance* (not the Uint8Array class!) with Buffer methods
 */
Buffer._augment = function _augment (arr) {
  arr.constructor = Buffer
  arr._isBuffer = true

  // save reference to original Uint8Array set method before overwriting
  arr._set = arr.set

  // deprecated
  arr.get = BP.get
  arr.set = BP.set

  arr.write = BP.write
  arr.toString = BP.toString
  arr.toLocaleString = BP.toString
  arr.toJSON = BP.toJSON
  arr.equals = BP.equals
  arr.compare = BP.compare
  arr.indexOf = BP.indexOf
  arr.copy = BP.copy
  arr.slice = BP.slice
  arr.readUIntLE = BP.readUIntLE
  arr.readUIntBE = BP.readUIntBE
  arr.readUInt8 = BP.readUInt8
  arr.readUInt16LE = BP.readUInt16LE
  arr.readUInt16BE = BP.readUInt16BE
  arr.readUInt32LE = BP.readUInt32LE
  arr.readUInt32BE = BP.readUInt32BE
  arr.readIntLE = BP.readIntLE
  arr.readIntBE = BP.readIntBE
  arr.readInt8 = BP.readInt8
  arr.readInt16LE = BP.readInt16LE
  arr.readInt16BE = BP.readInt16BE
  arr.readInt32LE = BP.readInt32LE
  arr.readInt32BE = BP.readInt32BE
  arr.readFloatLE = BP.readFloatLE
  arr.readFloatBE = BP.readFloatBE
  arr.readDoubleLE = BP.readDoubleLE
  arr.readDoubleBE = BP.readDoubleBE
  arr.writeUInt8 = BP.writeUInt8
  arr.writeUIntLE = BP.writeUIntLE
  arr.writeUIntBE = BP.writeUIntBE
  arr.writeUInt16LE = BP.writeUInt16LE
  arr.writeUInt16BE = BP.writeUInt16BE
  arr.writeUInt32LE = BP.writeUInt32LE
  arr.writeUInt32BE = BP.writeUInt32BE
  arr.writeIntLE = BP.writeIntLE
  arr.writeIntBE = BP.writeIntBE
  arr.writeInt8 = BP.writeInt8
  arr.writeInt16LE = BP.writeInt16LE
  arr.writeInt16BE = BP.writeInt16BE
  arr.writeInt32LE = BP.writeInt32LE
  arr.writeInt32BE = BP.writeInt32BE
  arr.writeFloatLE = BP.writeFloatLE
  arr.writeFloatBE = BP.writeFloatBE
  arr.writeDoubleLE = BP.writeDoubleLE
  arr.writeDoubleBE = BP.writeDoubleBE
  arr.fill = BP.fill
  arr.inspect = BP.inspect
  arr.toArrayBuffer = BP.toArrayBuffer

  return arr
}

var INVALID_BASE64_RE = /[^+\/0-9A-Za-z-_]/g

function base64clean (str) {
  // Node strips out invalid characters like \n and \t from the string, base64-js does not
  str = stringtrim(str).replace(INVALID_BASE64_RE, '')
  // Node converts strings with length < 2 to ''
  if (str.length < 2) return ''
  // Node allows for non-padded base64 strings (missing trailing ===), base64-js does not
  while (str.length % 4 !== 0) {
    str = str + '='
  }
  return str
}

function stringtrim (str) {
  if (str.trim) return str.trim()
  return str.replace(/^\s+|\s+$/g, '')
}

function toHex (n) {
  if (n < 16) return '0' + n.toString(16)
  return n.toString(16)
}

function utf8ToBytes (string, units) {
  units = units || Infinity
  var codePoint
  var length = string.length
  var leadSurrogate = null
  var bytes = []

  for (var i = 0; i < length; i++) {
    codePoint = string.charCodeAt(i)

    // is surrogate component
    if (codePoint > 0xD7FF && codePoint < 0xE000) {
      // last char was a lead
      if (!leadSurrogate) {
        // no lead yet
        if (codePoint > 0xDBFF) {
          // unexpected trail
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        } else if (i + 1 === length) {
          // unpaired lead
          if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
          continue
        }

        // valid lead
        leadSurrogate = codePoint

        continue
      }

      // 2 leads in a row
      if (codePoint < 0xDC00) {
        if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
        leadSurrogate = codePoint
        continue
      }

      // valid surrogate pair
      codePoint = leadSurrogate - 0xD800 << 10 | codePoint - 0xDC00 | 0x10000
    } else if (leadSurrogate) {
      // valid bmp char, but last char was a lead
      if ((units -= 3) > -1) bytes.push(0xEF, 0xBF, 0xBD)
    }

    leadSurrogate = null

    // encode utf8
    if (codePoint < 0x80) {
      if ((units -= 1) < 0) break
      bytes.push(codePoint)
    } else if (codePoint < 0x800) {
      if ((units -= 2) < 0) break
      bytes.push(
        codePoint >> 0x6 | 0xC0,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x10000) {
      if ((units -= 3) < 0) break
      bytes.push(
        codePoint >> 0xC | 0xE0,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else if (codePoint < 0x110000) {
      if ((units -= 4) < 0) break
      bytes.push(
        codePoint >> 0x12 | 0xF0,
        codePoint >> 0xC & 0x3F | 0x80,
        codePoint >> 0x6 & 0x3F | 0x80,
        codePoint & 0x3F | 0x80
      )
    } else {
      throw new Error('Invalid code point')
    }
  }

  return bytes
}

function asciiToBytes (str) {
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    // Node's code seems to be doing this and not & 0x7F..
    byteArray.push(str.charCodeAt(i) & 0xFF)
  }
  return byteArray
}

function utf16leToBytes (str, units) {
  var c, hi, lo
  var byteArray = []
  for (var i = 0; i < str.length; i++) {
    if ((units -= 2) < 0) break

    c = str.charCodeAt(i)
    hi = c >> 8
    lo = c % 256
    byteArray.push(lo)
    byteArray.push(hi)
  }

  return byteArray
}

function base64ToBytes (str) {
  return base64.toByteArray(base64clean(str))
}

function blitBuffer (src, dst, offset, length) {
  for (var i = 0; i < length; i++) {
    if ((i + offset >= dst.length) || (i >= src.length)) break
    dst[i + offset] = src[i]
  }
  return i
}

}).call(this,typeof global !== "undefined" ? global : typeof self !== "undefined" ? self : typeof window !== "undefined" ? window : {})

},{"base64-js":15,"ieee754":16,"is-array":17}],15:[function(require,module,exports){
var lookup = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

;(function (exports) {
	'use strict';

  var Arr = (typeof Uint8Array !== 'undefined')
    ? Uint8Array
    : Array

	var PLUS   = '+'.charCodeAt(0)
	var SLASH  = '/'.charCodeAt(0)
	var NUMBER = '0'.charCodeAt(0)
	var LOWER  = 'a'.charCodeAt(0)
	var UPPER  = 'A'.charCodeAt(0)
	var PLUS_URL_SAFE = '-'.charCodeAt(0)
	var SLASH_URL_SAFE = '_'.charCodeAt(0)

	function decode (elt) {
		var code = elt.charCodeAt(0)
		if (code === PLUS ||
		    code === PLUS_URL_SAFE)
			return 62 // '+'
		if (code === SLASH ||
		    code === SLASH_URL_SAFE)
			return 63 // '/'
		if (code < NUMBER)
			return -1 //no match
		if (code < NUMBER + 10)
			return code - NUMBER + 26 + 26
		if (code < UPPER + 26)
			return code - UPPER
		if (code < LOWER + 26)
			return code - LOWER + 26
	}

	function b64ToByteArray (b64) {
		var i, j, l, tmp, placeHolders, arr

		if (b64.length % 4 > 0) {
			throw new Error('Invalid string. Length must be a multiple of 4')
		}

		// the number of equal signs (place holders)
		// if there are two placeholders, than the two characters before it
		// represent one byte
		// if there is only one, then the three characters before it represent 2 bytes
		// this is just a cheap hack to not do indexOf twice
		var len = b64.length
		placeHolders = '=' === b64.charAt(len - 2) ? 2 : '=' === b64.charAt(len - 1) ? 1 : 0

		// base64 is 4/3 + up to two characters of the original data
		arr = new Arr(b64.length * 3 / 4 - placeHolders)

		// if there are placeholders, only get up to the last complete 4 chars
		l = placeHolders > 0 ? b64.length - 4 : b64.length

		var L = 0

		function push (v) {
			arr[L++] = v
		}

		for (i = 0, j = 0; i < l; i += 4, j += 3) {
			tmp = (decode(b64.charAt(i)) << 18) | (decode(b64.charAt(i + 1)) << 12) | (decode(b64.charAt(i + 2)) << 6) | decode(b64.charAt(i + 3))
			push((tmp & 0xFF0000) >> 16)
			push((tmp & 0xFF00) >> 8)
			push(tmp & 0xFF)
		}

		if (placeHolders === 2) {
			tmp = (decode(b64.charAt(i)) << 2) | (decode(b64.charAt(i + 1)) >> 4)
			push(tmp & 0xFF)
		} else if (placeHolders === 1) {
			tmp = (decode(b64.charAt(i)) << 10) | (decode(b64.charAt(i + 1)) << 4) | (decode(b64.charAt(i + 2)) >> 2)
			push((tmp >> 8) & 0xFF)
			push(tmp & 0xFF)
		}

		return arr
	}

	function uint8ToBase64 (uint8) {
		var i,
			extraBytes = uint8.length % 3, // if we have 1 byte left, pad 2 bytes
			output = "",
			temp, length

		function encode (num) {
			return lookup.charAt(num)
		}

		function tripletToBase64 (num) {
			return encode(num >> 18 & 0x3F) + encode(num >> 12 & 0x3F) + encode(num >> 6 & 0x3F) + encode(num & 0x3F)
		}

		// go through the array every three bytes, we'll deal with trailing stuff later
		for (i = 0, length = uint8.length - extraBytes; i < length; i += 3) {
			temp = (uint8[i] << 16) + (uint8[i + 1] << 8) + (uint8[i + 2])
			output += tripletToBase64(temp)
		}

		// pad the end with zeros, but make sure to not forget the extra bytes
		switch (extraBytes) {
			case 1:
				temp = uint8[uint8.length - 1]
				output += encode(temp >> 2)
				output += encode((temp << 4) & 0x3F)
				output += '=='
				break
			case 2:
				temp = (uint8[uint8.length - 2] << 8) + (uint8[uint8.length - 1])
				output += encode(temp >> 10)
				output += encode((temp >> 4) & 0x3F)
				output += encode((temp << 2) & 0x3F)
				output += '='
				break
		}

		return output
	}

	exports.toByteArray = b64ToByteArray
	exports.fromByteArray = uint8ToBase64
}(typeof exports === 'undefined' ? (this.base64js = {}) : exports))

},{}],16:[function(require,module,exports){
exports.read = function (buffer, offset, isLE, mLen, nBytes) {
  var e, m
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var nBits = -7
  var i = isLE ? (nBytes - 1) : 0
  var d = isLE ? -1 : 1
  var s = buffer[offset + i]

  i += d

  e = s & ((1 << (-nBits)) - 1)
  s >>= (-nBits)
  nBits += eLen
  for (; nBits > 0; e = e * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  m = e & ((1 << (-nBits)) - 1)
  e >>= (-nBits)
  nBits += mLen
  for (; nBits > 0; m = m * 256 + buffer[offset + i], i += d, nBits -= 8) {}

  if (e === 0) {
    e = 1 - eBias
  } else if (e === eMax) {
    return m ? NaN : ((s ? -1 : 1) * Infinity)
  } else {
    m = m + Math.pow(2, mLen)
    e = e - eBias
  }
  return (s ? -1 : 1) * m * Math.pow(2, e - mLen)
}

exports.write = function (buffer, value, offset, isLE, mLen, nBytes) {
  var e, m, c
  var eLen = nBytes * 8 - mLen - 1
  var eMax = (1 << eLen) - 1
  var eBias = eMax >> 1
  var rt = (mLen === 23 ? Math.pow(2, -24) - Math.pow(2, -77) : 0)
  var i = isLE ? 0 : (nBytes - 1)
  var d = isLE ? 1 : -1
  var s = value < 0 || (value === 0 && 1 / value < 0) ? 1 : 0

  value = Math.abs(value)

  if (isNaN(value) || value === Infinity) {
    m = isNaN(value) ? 1 : 0
    e = eMax
  } else {
    e = Math.floor(Math.log(value) / Math.LN2)
    if (value * (c = Math.pow(2, -e)) < 1) {
      e--
      c *= 2
    }
    if (e + eBias >= 1) {
      value += rt / c
    } else {
      value += rt * Math.pow(2, 1 - eBias)
    }
    if (value * c >= 2) {
      e++
      c /= 2
    }

    if (e + eBias >= eMax) {
      m = 0
      e = eMax
    } else if (e + eBias >= 1) {
      m = (value * c - 1) * Math.pow(2, mLen)
      e = e + eBias
    } else {
      m = value * Math.pow(2, eBias - 1) * Math.pow(2, mLen)
      e = 0
    }
  }

  for (; mLen >= 8; buffer[offset + i] = m & 0xff, i += d, m /= 256, mLen -= 8) {}

  e = (e << mLen) | m
  eLen += mLen
  for (; eLen > 0; buffer[offset + i] = e & 0xff, i += d, e /= 256, eLen -= 8) {}

  buffer[offset + i - d] |= s * 128
}

},{}],17:[function(require,module,exports){

/**
 * isArray
 */

var isArray = Array.isArray;

/**
 * toString
 */

var str = Object.prototype.toString;

/**
 * Whether or not the given `val`
 * is an array.
 *
 * example:
 *
 *        isArray([]);
 *        // > true
 *        isArray(arguments);
 *        // > false
 *        isArray('');
 *        // > false
 *
 * @param {mixed} val
 * @return {bool}
 */

module.exports = isArray || function (val) {
  return !! val && '[object Array]' == str.call(val);
};

},{}],18:[function(require,module,exports){
// Copyright Joyent, Inc. and other Node contributors.
//
// Permission is hereby granted, free of charge, to any person obtaining a
// copy of this software and associated documentation files (the
// "Software"), to deal in the Software without restriction, including
// without limitation the rights to use, copy, modify, merge, publish,
// distribute, sublicense, and/or sell copies of the Software, and to permit
// persons to whom the Software is furnished to do so, subject to the
// following conditions:
//
// The above copyright notice and this permission notice shall be included
// in all copies or substantial portions of the Software.
//
// THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS
// OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
// MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN
// NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM,
// DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR
// OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE
// USE OR OTHER DEALINGS IN THE SOFTWARE.

function EventEmitter() {
  this._events = this._events || {};
  this._maxListeners = this._maxListeners || undefined;
}
module.exports = EventEmitter;

// Backwards-compat with node 0.10.x
EventEmitter.EventEmitter = EventEmitter;

EventEmitter.prototype._events = undefined;
EventEmitter.prototype._maxListeners = undefined;

// By default EventEmitters will print a warning if more than 10 listeners are
// added to it. This is a useful default which helps finding memory leaks.
EventEmitter.defaultMaxListeners = 10;

// Obviously not all Emitters should be limited to 10. This function allows
// that to be increased. Set to zero for unlimited.
EventEmitter.prototype.setMaxListeners = function(n) {
  if (!isNumber(n) || n < 0 || isNaN(n))
    throw TypeError('n must be a positive number');
  this._maxListeners = n;
  return this;
};

EventEmitter.prototype.emit = function(type) {
  var er, handler, len, args, i, listeners;

  if (!this._events)
    this._events = {};

  // If there is no 'error' event listener then throw.
  if (type === 'error') {
    if (!this._events.error ||
        (isObject(this._events.error) && !this._events.error.length)) {
      er = arguments[1];
      if (er instanceof Error) {
        throw er; // Unhandled 'error' event
      }
      throw TypeError('Uncaught, unspecified "error" event.');
    }
  }

  handler = this._events[type];

  if (isUndefined(handler))
    return false;

  if (isFunction(handler)) {
    switch (arguments.length) {
      // fast cases
      case 1:
        handler.call(this);
        break;
      case 2:
        handler.call(this, arguments[1]);
        break;
      case 3:
        handler.call(this, arguments[1], arguments[2]);
        break;
      // slower
      default:
        len = arguments.length;
        args = new Array(len - 1);
        for (i = 1; i < len; i++)
          args[i - 1] = arguments[i];
        handler.apply(this, args);
    }
  } else if (isObject(handler)) {
    len = arguments.length;
    args = new Array(len - 1);
    for (i = 1; i < len; i++)
      args[i - 1] = arguments[i];

    listeners = handler.slice();
    len = listeners.length;
    for (i = 0; i < len; i++)
      listeners[i].apply(this, args);
  }

  return true;
};

EventEmitter.prototype.addListener = function(type, listener) {
  var m;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events)
    this._events = {};

  // To avoid recursion in the case that type === "newListener"! Before
  // adding it to the listeners, first emit "newListener".
  if (this._events.newListener)
    this.emit('newListener', type,
              isFunction(listener.listener) ?
              listener.listener : listener);

  if (!this._events[type])
    // Optimize the case of one listener. Don't need the extra array object.
    this._events[type] = listener;
  else if (isObject(this._events[type]))
    // If we've already got an array, just append.
    this._events[type].push(listener);
  else
    // Adding the second element, need to change to array.
    this._events[type] = [this._events[type], listener];

  // Check for listener leak
  if (isObject(this._events[type]) && !this._events[type].warned) {
    var m;
    if (!isUndefined(this._maxListeners)) {
      m = this._maxListeners;
    } else {
      m = EventEmitter.defaultMaxListeners;
    }

    if (m && m > 0 && this._events[type].length > m) {
      this._events[type].warned = true;
      console.error('(node) warning: possible EventEmitter memory ' +
                    'leak detected. %d listeners added. ' +
                    'Use emitter.setMaxListeners() to increase limit.',
                    this._events[type].length);
      if (typeof console.trace === 'function') {
        // not supported in IE 10
        console.trace();
      }
    }
  }

  return this;
};

EventEmitter.prototype.on = EventEmitter.prototype.addListener;

EventEmitter.prototype.once = function(type, listener) {
  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  var fired = false;

  function g() {
    this.removeListener(type, g);

    if (!fired) {
      fired = true;
      listener.apply(this, arguments);
    }
  }

  g.listener = listener;
  this.on(type, g);

  return this;
};

// emits a 'removeListener' event iff the listener was removed
EventEmitter.prototype.removeListener = function(type, listener) {
  var list, position, length, i;

  if (!isFunction(listener))
    throw TypeError('listener must be a function');

  if (!this._events || !this._events[type])
    return this;

  list = this._events[type];
  length = list.length;
  position = -1;

  if (list === listener ||
      (isFunction(list.listener) && list.listener === listener)) {
    delete this._events[type];
    if (this._events.removeListener)
      this.emit('removeListener', type, listener);

  } else if (isObject(list)) {
    for (i = length; i-- > 0;) {
      if (list[i] === listener ||
          (list[i].listener && list[i].listener === listener)) {
        position = i;
        break;
      }
    }

    if (position < 0)
      return this;

    if (list.length === 1) {
      list.length = 0;
      delete this._events[type];
    } else {
      list.splice(position, 1);
    }

    if (this._events.removeListener)
      this.emit('removeListener', type, listener);
  }

  return this;
};

EventEmitter.prototype.removeAllListeners = function(type) {
  var key, listeners;

  if (!this._events)
    return this;

  // not listening for removeListener, no need to emit
  if (!this._events.removeListener) {
    if (arguments.length === 0)
      this._events = {};
    else if (this._events[type])
      delete this._events[type];
    return this;
  }

  // emit removeListener for all listeners on all events
  if (arguments.length === 0) {
    for (key in this._events) {
      if (key === 'removeListener') continue;
      this.removeAllListeners(key);
    }
    this.removeAllListeners('removeListener');
    this._events = {};
    return this;
  }

  listeners = this._events[type];

  if (isFunction(listeners)) {
    this.removeListener(type, listeners);
  } else {
    // LIFO order
    while (listeners.length)
      this.removeListener(type, listeners[listeners.length - 1]);
  }
  delete this._events[type];

  return this;
};

EventEmitter.prototype.listeners = function(type) {
  var ret;
  if (!this._events || !this._events[type])
    ret = [];
  else if (isFunction(this._events[type]))
    ret = [this._events[type]];
  else
    ret = this._events[type].slice();
  return ret;
};

EventEmitter.listenerCount = function(emitter, type) {
  var ret;
  if (!emitter._events || !emitter._events[type])
    ret = 0;
  else if (isFunction(emitter._events[type]))
    ret = 1;
  else
    ret = emitter._events[type].length;
  return ret;
};

function isFunction(arg) {
  return typeof arg === 'function';
}

function isNumber(arg) {
  return typeof arg === 'number';
}

function isObject(arg) {
  return typeof arg === 'object' && arg !== null;
}

function isUndefined(arg) {
  return arg === void 0;
}

},{}],19:[function(require,module,exports){
// shim for using process in browser

var process = module.exports = {};
var queue = [];
var draining = false;
var currentQueue;
var queueIndex = -1;

function cleanUpNextTick() {
    draining = false;
    if (currentQueue.length) {
        queue = currentQueue.concat(queue);
    } else {
        queueIndex = -1;
    }
    if (queue.length) {
        drainQueue();
    }
}

function drainQueue() {
    if (draining) {
        return;
    }
    var timeout = setTimeout(cleanUpNextTick);
    draining = true;

    var len = queue.length;
    while(len) {
        currentQueue = queue;
        queue = [];
        while (++queueIndex < len) {
            if (currentQueue) {
                currentQueue[queueIndex].run();
            }
        }
        queueIndex = -1;
        len = queue.length;
    }
    currentQueue = null;
    draining = false;
    clearTimeout(timeout);
}

process.nextTick = function (fun) {
    var args = new Array(arguments.length - 1);
    if (arguments.length > 1) {
        for (var i = 1; i < arguments.length; i++) {
            args[i - 1] = arguments[i];
        }
    }
    queue.push(new Item(fun, args));
    if (queue.length === 1 && !draining) {
        setTimeout(drainQueue, 0);
    }
};

// v8 likes predictible objects
function Item(fun, array) {
    this.fun = fun;
    this.array = array;
}
Item.prototype.run = function () {
    this.fun.apply(null, this.array);
};
process.title = 'browser';
process.browser = true;
process.env = {};
process.argv = [];
process.version = ''; // empty string to avoid regexp issues
process.versions = {};

function noop() {}

process.on = noop;
process.addListener = noop;
process.once = noop;
process.off = noop;
process.removeListener = noop;
process.removeAllListeners = noop;
process.emit = noop;

process.binding = function (name) {
    throw new Error('process.binding is not supported');
};

process.cwd = function () { return '/' };
process.chdir = function (dir) {
    throw new Error('process.chdir is not supported');
};
process.umask = function() { return 0; };

},{}],20:[function(require,module,exports){
/**
 * Module dependencies.
 */

var Emitter = require('component-emitter')

/**
 * Expose `scene`.
 */

module.exports = Application

/**
 * Create a new `Application`.
 *
 * @param {Object} element Optional initial element
 */

function Application (element) {
  if (!(this instanceof Application)) return new Application(element)
  this.options = {}
  this.sources = {}
  this.element = element
}

/**
 * Mixin `Emitter`.
 */

Emitter(Application.prototype)

/**
 * Add a plugin
 *
 * @param {Function} plugin
 */

Application.prototype.use = function (plugin) {
  plugin(this)
  return this
}

/**
 * Set an option
 *
 * @param {String} name
 */

Application.prototype.option = function (name, val) {
  this.options[name] = val
  return this
}

/**
 * Set value used somewhere in the IO network.
 */

Application.prototype.set = function (name, data) {
  this.sources[name] = data
  this.emit('source', name, data)
  return this
}

/**
 * Mount a virtual element.
 *
 * @param {VirtualElement} element
 */

Application.prototype.mount = function (element) {
  this.element = element
  this.emit('mount', element)
  return this
}

/**
 * Remove the world. Unmount everything.
 */

Application.prototype.unmount = function () {
  if (!this.element) return
  this.element = null
  this.emit('unmount')
  return this
}

},{"component-emitter":27}],21:[function(require,module,exports){
/**
 * All of the events can bind to
 */

module.exports = {
  onBlur: 'blur',
  onChange: 'change',
  onClick: 'click',
  onContextMenu: 'contextmenu',
  onCopy: 'copy',
  onCut: 'cut',
  onDoubleClick: 'dblclick',
  onDrag: 'drag',
  onDragEnd: 'dragend',
  onDragEnter: 'dragenter',
  onDragExit: 'dragexit',
  onDragLeave: 'dragleave',
  onDragOver: 'dragover',
  onDragStart: 'dragstart',
  onDrop: 'drop',
  onError: 'error',
  onFocus: 'focus',
  onInput: 'input',
  onInvalid: 'invalid',
  onKeyDown: 'keydown',
  onKeyPress: 'keypress',
  onKeyUp: 'keyup',
  onMouseDown: 'mousedown',
  onMouseEnter: 'mouseenter',
  onMouseLeave: 'mouseleave',
  onMouseMove: 'mousemove',
  onMouseOut: 'mouseout',
  onMouseOver: 'mouseover',
  onMouseUp: 'mouseup',
  onPaste: 'paste',
  onReset: 'reset',
  onScroll: 'scroll',
  onSubmit: 'submit',
  onTouchCancel: 'touchcancel',
  onTouchEnd: 'touchend',
  onTouchMove: 'touchmove',
  onTouchStart: 'touchstart',
  onWheel: 'wheel'
}

},{}],22:[function(require,module,exports){
/**
 * Create the application.
 */

exports.tree =
exports.scene =
exports.deku = require('./application')

/**
 * Render scenes to the DOM.
 */

if (typeof document !== 'undefined') {
  exports.render = require('./render')
}

/**
 * Render scenes to a string
 */

exports.renderString = require('./stringify')
},{"./application":20,"./render":24,"./stringify":25}],23:[function(require,module,exports){
var type = require('component-type')

/**
 * Returns the type of a virtual node
 *
 * @param  {Object} node
 * @return {String}
 */

module.exports = function nodeType (node) {
  var v = type(node)
  if (v === 'null' || node === false) return 'empty'
  if (v !== 'object') return 'text'
  if (type(node.type) === 'string') return 'element'
  return 'component'
}

},{"component-type":29}],24:[function(require,module,exports){
/**
 * Dependencies.
 */

var raf = require('component-raf')
var isDom = require('is-dom')
var uid = require('get-uid')
var keypath = require('object-path')
var events = require('./events')
var svg = require('./svg')
var defaults = require('object-defaults')
var forEach = require('fast.js/forEach')
var assign = require('fast.js/object/assign')
var reduce = require('fast.js/reduce')
var nodeType = require('./node-type')

/**
 * Expose `dom`.
 */

module.exports = render

/**
 * Render an app to the DOM
 *
 * @param {Application} app
 * @param {HTMLElement} container
 * @param {Object} opts
 *
 * @return {Object}
 */

function render (app, container, opts) {
  var frameId
  var isRendering
  var rootId = 'root'
  var currentElement
  var currentNativeElement
  var connections = {}
  var components = {}
  var entities = {}
  var handlers = {}
  var mountQueue = []
  var children = {}
  children[rootId] = {}

  if (!isDom(container)) {
    throw new Error('Container element must be a DOM element')
  }

  /**
   * Rendering options. Batching is only ever really disabled
   * when running tests, and pooling can be disabled if the user
   * is doing something stupid with the DOM in their components.
   */

  var options = defaults(assign({}, app.options || {}, opts || {}), {
    batching: true
  })

  /**
   * Listen to DOM events
   */
  var rootElement = getRootElement(container)
  addNativeEventListeners()

  /**
   * Watch for changes to the app so that we can update
   * the DOM as needed.
   */

  app.on('unmount', onunmount)
  app.on('mount', onmount)
  app.on('source', onupdate)

  /**
   * If the app has already mounted an element, we can just
   * render that straight away.
   */

  if (app.element) render()

  /**
   * Teardown the DOM rendering so that it stops
   * rendering and everything can be garbage collected.
   */

  function teardown () {
    removeNativeEventListeners()
    removeNativeElement()
    app.off('unmount', onunmount)
    app.off('mount', onmount)
    app.off('source', onupdate)
  }

  /**
   * Swap the current rendered node with a new one that is rendered
   * from the new virtual element mounted on the app.
   *
   * @param {VirtualElement} element
   */

  function onmount () {
    invalidate()
  }

  /**
   * If the app unmounts an element, we should clear out the current
   * rendered element. This will remove all the entities.
   */

  function onunmount () {
    removeNativeElement()
    currentElement = null
  }

  /**
   * Update all components that are bound to the source
   *
   * @param {String} name
   * @param {*} data
   */

  function onupdate (name, data) {
    if (!connections[name]) return;
    connections[name].forEach(function(update) {
      update(data)
    })
  }

  /**
   * Render and mount a component to the native dom.
   *
   * @param {Entity} entity
   * @return {HTMLElement}
   */

  function mountEntity (entity) {
    register(entity)
    setSources(entity)
    children[entity.id] = {}
    entities[entity.id] = entity

    // commit initial state and props.
    commit(entity)

    // callback before mounting.
    trigger('beforeMount', entity, [entity.context])
    trigger('beforeRender', entity, [entity.context])

    // render virtual element.
    var virtualElement = renderEntity(entity)
    // create native element.
    var nativeElement = toNative(entity.id, '0', virtualElement)

    entity.virtualElement = virtualElement
    entity.nativeElement = nativeElement

    // Fire afterRender and afterMount hooks at the end
    // of the render cycle
    mountQueue.push(entity.id)

    return nativeElement
  }

  /**
   * Remove a component from the native dom.
   *
   * @param {Entity} entity
   */

  function unmountEntity (entityId) {
    var entity = entities[entityId]
    if (!entity) return
    trigger('beforeUnmount', entity, [entity.context, entity.nativeElement])
    unmountChildren(entityId)
    removeAllEvents(entityId)
    var componentEntities = components[entityId].entities;
    delete componentEntities[entityId]
    delete components[entityId]
    delete entities[entityId]
    delete children[entityId]
  }

  /**
   * Render the entity and make sure it returns a node
   *
   * @param {Entity} entity
   *
   * @return {VirtualTree}
   */

  function renderEntity (entity) {
    var component = entity.component
    var fn = typeof component === 'function' ? component : component.render
    if (!fn) throw new Error('Component needs a render function')
    var result = fn(entity.context, setState(entity))
    if (!result) throw new Error('Render function must return an element.')
    return result
  }

  /**
   * Whenever setState or setProps is called, we mark the entity
   * as dirty in the renderer. This lets us optimize the re-rendering
   * and skip components that definitely haven't changed.
   *
   * @param {Entity} entity
   *
   * @return {Function} A curried function for updating the state of an entity
   */

  function setState (entity) {
    return function (nextState) {
      updateEntityState(entity, nextState)
    }
  }

  /**
   * Tell the app it's dirty and needs to re-render. If batching is disabled
   * we can just trigger a render immediately, otherwise we'll wait until
   * the next available frame.
   */

  function invalidate () {
    if (!options.batching) {
      if (!isRendering) render()
    } else {
      if (!frameId) frameId = raf(render)
    }
  }

  /**
   * Update the DOM. If the update fails we stop the loop
   * so we don't get errors on every frame.
   *
   * @api public
   */

  function render () {
    // If this is called synchronously we need to
    // cancel any pending future updates
    clearFrame()

    // If the rendering from the previous frame is still going,
    // we'll just wait until the next frame. Ideally renders should
    // not take over 16ms to stay within a single frame, but this should
    // catch it if it does.
    if (isRendering) {
      frameId = raf(render)
      return
    } else {
      isRendering = true
    }

    // 1. If there isn't a native element rendered for the current mounted element
    // then we need to create it from scratch.
    // 2. If a new element has been mounted, we should diff them.
    // 3. We should update check all child components for changes.
    if (!currentNativeElement) {
      currentElement = app.element
      currentNativeElement = toNative(rootId, '0', currentElement)
      if (container.children.length > 0) {
        console.info('deku: The container element is not empty. These elements will be removed. Read more: http://cl.ly/b0Sr')
      }
      if (container === document.body) {
        console.warn('deku: Using document.body is allowed but it can cause some issues. Read more: http://cl.ly/b0SC')
      }
      removeAllChildren(container)
      container.appendChild(currentNativeElement)
    } else if (currentElement !== app.element) {
      currentNativeElement = patch(rootId, currentElement, app.element, currentNativeElement)
      currentElement = app.element
      updateChildren(rootId)
    } else {
      updateChildren(rootId)
    }

    // Call mount events on all new entities
    flushMountQueue()

    // Allow rendering again.
    isRendering = false

  }

  /**
   * Call hooks for all new entities that have been created in
   * the last render from the bottom up.
   */

  function flushMountQueue () {
    while (mountQueue.length > 0) {
      var entityId = mountQueue.shift()
      var entity = entities[entityId]
      trigger('afterRender', entity, [entity.context, entity.nativeElement])
      trigger('afterMount', entity, [entity.context, entity.nativeElement, setState(entity)])
    }
  }

  /**
   * Clear the current scheduled frame
   */

  function clearFrame () {
    if (!frameId) return
    raf.cancel(frameId)
    frameId = 0
  }

  /**
   * Update a component.
   *
   * The entity is just the data object for a component instance.
   *
   * @param {String} id Component instance id.
   */

  function updateEntity (entityId) {
    var entity = entities[entityId]
    setSources(entity)

    if (!shouldUpdate(entity)) {
      commit(entity)
      return updateChildren(entityId)
    }

    var currentTree = entity.virtualElement
    var nextProps = entity.pendingProps
    var nextState = entity.pendingState
    var previousState = entity.context.state
    var previousProps = entity.context.props

    // hook before rendering. could modify state just before the render occurs.
    trigger('beforeUpdate', entity, [entity.context, nextProps, nextState])
    trigger('beforeRender', entity, [entity.context])

    // commit state and props.
    commit(entity)

    // re-render.
    var nextTree = renderEntity(entity)

    // if the tree is the same we can just skip this component
    // but we should still check the children to see if they're dirty.
    // This allows us to memoize the render function of components.
    if (nextTree === currentTree) return updateChildren(entityId)

    // apply new virtual tree to native dom.
    entity.nativeElement = patch(entityId, currentTree, nextTree, entity.nativeElement)
    entity.virtualElement = nextTree
    updateChildren(entityId)

    // trigger render hook
    trigger('afterRender', entity, [entity.context, entity.nativeElement])

    // trigger afterUpdate after all children have updated.
    trigger('afterUpdate', entity, [entity.context, previousProps, previousState, setState(entity)])
  }

  /**
   * Update all the children of an entity.
   *
   * @param {String} id Component instance id.
   */

  function updateChildren (entityId) {
    forEach(children[entityId], function (childId) {
      updateEntity(childId)
    })
  }

  /**
   * Remove all of the child entities of an entity
   *
   * @param {Entity} entity
   */

  function unmountChildren (entityId) {
    forEach(children[entityId], function (childId) {
      unmountEntity(childId)
    })
  }

  /**
   * Remove the root element. If this is called synchronously we need to
   * cancel any pending future updates.
   */

  function removeNativeElement () {
    clearFrame()
    removeElement(rootId, '0', currentNativeElement)
    currentNativeElement = null
  }

  /**
   * Create a native element from a virtual element.
   *
   * @param {String} entityId
   * @param {String} path
   * @param {Object} vnode
   *
   * @return {HTMLDocumentFragment}
   */

  function toNative (entityId, path, vnode) {
    switch (nodeType(vnode)) {
      case 'text': return toNativeText(vnode)
      case 'empty': return toNativeEmptyElement(entityId, path)
      case 'element': return toNativeElement(entityId, path, vnode)
      case 'component': return toNativeComponent(entityId, path, vnode)
    }
  }

  /**
   * Create a native text element from a virtual element.
   *
   * @param {Object} vnode
   */

  function toNativeText (text) {
    return document.createTextNode(text)
  }

  /**
   * Create a native element from a virtual element.
   */

  function toNativeElement (entityId, path, vnode) {
    var el
    var attributes = vnode.attributes
    var tagName = vnode.type
    var childNodes = vnode.children

    // create element either from pool or fresh.
    if (svg.isElement(tagName)) {
      el = document.createElementNS(svg.namespace, tagName)
    } else {
      el = document.createElement(tagName)
    }

    // set attributes.
    forEach(attributes, function (value, name) {
      setAttribute(entityId, path, el, name, value)
    })

    // add children.
    forEach(childNodes, function (child, i) {
      var childEl = toNative(entityId, path + '.' + i, child)
      if (!childEl.parentNode) el.appendChild(childEl)
    })

    // store keys on the native element for fast event handling.
    el.__entity__ = entityId
    el.__path__ = path

    return el
  }

  /**
   * Create a native element from a virtual element.
   */

  function toNativeEmptyElement (entityId, path) {
    var el = document.createElement('noscript')
    el.__entity__ = entityId
    el.__path__ = path
    return el
  }

  /**
   * Create a native element from a component.
   */

  function toNativeComponent (entityId, path, vnode) {
    var child = new Entity(vnode.type, assign({ children: vnode.children }, vnode.attributes), entityId)
    children[entityId][path] = child.id
    return mountEntity(child)
  }

  /**
   * Patch an element with the diff from two trees.
   */

  function patch (entityId, prev, next, el) {
    return diffNode('0', entityId, prev, next, el)
  }

  /**
   * Create a diff between two trees of nodes.
   */

  function diffNode (path, entityId, prev, next, el) {
    var leftType = nodeType(prev)
    var rightType = nodeType(next)

    // Type changed. This could be from element->text, text->ComponentA,
    // ComponentA->ComponentB etc. But NOT div->span. These are the same type
    // (ElementNode) but different tag name.
    if (leftType !== rightType) return replaceElement(entityId, path, el, next)

    switch (rightType) {
      case 'text': return diffText(prev, next, el)
      case 'empty': return el
      case 'element': return diffElement(path, entityId, prev, next, el)
      case 'component': return diffComponent(path, entityId, prev, next, el)
    }
  }

  /**
   * Diff two text nodes and update the element.
   */

  function diffText (previous, current, el) {
    if (current !== previous) el.data = current
    return el
  }

  /**
   * Diff the children of an ElementNode.
   */

  function diffChildren (path, entityId, prev, next, el) {
    var positions = []
    var hasKeys = false
    var childNodes = Array.prototype.slice.apply(el.childNodes)
    var leftKeys = reduce(prev.children, keyMapReducer, {})
    var rightKeys = reduce(next.children, keyMapReducer, {})
    var currentChildren = assign({}, children[entityId])

    function keyMapReducer (acc, child, i) {
      if (child && child.attributes && child.attributes.key != null) {
        acc[child.attributes.key] = {
          element: child,
          index: i
        }
        hasKeys = true
      }
      return acc
    }

    // Diff all of the nodes that have keys. This lets us re-used elements
    // instead of overriding them and lets us move them around.
    if (hasKeys) {

      // Removals
      forEach(leftKeys, function (leftNode, key) {
        if (rightKeys[key] == null) {
          var leftPath = path + '.' + leftNode.index
          removeElement(
            entityId,
            leftPath,
            childNodes[leftNode.index]
          )
        }
      })

      // Update nodes
      forEach(rightKeys, function (rightNode, key) {
        var leftNode = leftKeys[key]

        // We only want updates for now
        if (leftNode == null) return

        var leftPath = path + '.' + leftNode.index

        // Updated
        positions[rightNode.index] = diffNode(
          leftPath,
          entityId,
          leftNode.element,
          rightNode.element,
          childNodes[leftNode.index]
        )
      })

      // Update the positions of all child components and event handlers
      forEach(rightKeys, function (rightNode, key) {
        var leftNode = leftKeys[key]

        // We just want elements that have moved around
        if (leftNode == null || leftNode.index === rightNode.index) return

        var rightPath = path + '.' + rightNode.index
        var leftPath = path + '.' + leftNode.index

        // Update all the child component path positions to match
        // the latest positions if they've changed. This is a bit hacky.
        forEach(currentChildren, function (childId, childPath) {
          if (leftPath === childPath) {
            delete children[entityId][childPath]
            children[entityId][rightPath] = childId
          }
        })
      })

      // Now add all of the new nodes last in case their path
      // would have conflicted with one of the previous paths.
      forEach(rightKeys, function (rightNode, key) {
        var rightPath = path + '.' + rightNode.index
        if (leftKeys[key] == null) {
          positions[rightNode.index] = toNative(
            entityId,
            rightPath,
            rightNode.element
          )
        }
      })

    } else {
      var maxLength = Math.max(prev.children.length, next.children.length)

      // Now diff all of the nodes that don't have keys
      for (var i = 0; i < maxLength; i++) {
        var leftNode = prev.children[i]
        var rightNode = next.children[i]

        // Removals
        if (rightNode === undefined) {
          removeElement(
            entityId,
            path + '.' + i,
            childNodes[i]
          )
          continue
        }

        // New Node
        if (leftNode === undefined) {
          positions[i] = toNative(
            entityId,
            path + '.' + i,
            rightNode
          )
          continue
        }

        // Updated
        positions[i] = diffNode(
          path + '.' + i,
          entityId,
          leftNode,
          rightNode,
          childNodes[i]
        )
      }
    }

    // Reposition all the elements
    forEach(positions, function (childEl, newPosition) {
      var target = el.childNodes[newPosition]
      if (childEl && childEl !== target) {
        if (target) {
          el.insertBefore(childEl, target)
        } else {
          el.appendChild(childEl)
        }
      }
    })
  }

  /**
   * Diff the attributes and add/remove them.
   */

  function diffAttributes (prev, next, el, entityId, path) {
    var nextAttrs = next.attributes
    var prevAttrs = prev.attributes

    // add new attrs
    forEach(nextAttrs, function (value, name) {
      if (events[name] || !(name in prevAttrs) || prevAttrs[name] !== value) {
        setAttribute(entityId, path, el, name, value)
      }
    })

    // remove old attrs
    forEach(prevAttrs, function (value, name) {
      if (!(name in nextAttrs)) {
        removeAttribute(entityId, path, el, name)
      }
    })
  }

  /**
   * Update a component with the props from the next node. If
   * the component type has changed, we'll just remove the old one
   * and replace it with the new component.
   */

  function diffComponent (path, entityId, prev, next, el) {
    if (next.type !== prev.type) {
      return replaceElement(entityId, path, el, next)
    } else {
      var targetId = children[entityId][path]

      // This is a hack for now
      if (targetId) {
        updateEntityProps(targetId, assign({ children: next.children }, next.attributes))
      }

      return el
    }
  }

  /**
   * Diff two element nodes.
   */

  function diffElement (path, entityId, prev, next, el) {
    if (next.type !== prev.type) return replaceElement(entityId, path, el, next)
    diffAttributes(prev, next, el, entityId, path)
    diffChildren(path, entityId, prev, next, el)
    return el
  }

  /**
   * Removes an element from the DOM and unmounts and components
   * that are within that branch
   *
   * side effects:
   *   - removes element from the DOM
   *   - removes internal references
   *
   * @param {String} entityId
   * @param {String} path
   * @param {HTMLElement} el
   */

  function removeElement (entityId, path, el) {
    var childrenByPath = children[entityId]
    var childId = childrenByPath[path]
    var entityHandlers = handlers[entityId] || {}
    var removals = []

    // If the path points to a component we should use that
    // components element instead, because it might have moved it.
    if (childId) {
      var child = entities[childId]
      el = child.nativeElement
      unmountEntity(childId)
      removals.push(path)
    } else {

      // Just remove the text node
      if (!isElement(el)) return el && el.parentNode.removeChild(el)

      // Then we need to find any components within this
      // branch and unmount them.
      forEach(childrenByPath, function (childId, childPath) {
        if (childPath === path || isWithinPath(path, childPath)) {
          unmountEntity(childId)
          removals.push(childPath)
        }
      })

      // Remove all events at this path or below it
      forEach(entityHandlers, function (fn, handlerPath) {
        if (handlerPath === path || isWithinPath(path, handlerPath)) {
          removeEvent(entityId, handlerPath)
        }
      })
    }

    // Remove the paths from the object without touching the
    // old object. This keeps the object using fast properties.
    forEach(removals, function (path) {
      delete children[entityId][path]
    })

    // Remove it from the DOM
    el.parentNode.removeChild(el)
  }

  /**
   * Replace an element in the DOM. Removing all components
   * within that element and re-rendering the new virtual node.
   *
   * @param {Entity} entity
   * @param {String} path
   * @param {HTMLElement} el
   * @param {Object} vnode
   *
   * @return {void}
   */

  function replaceElement (entityId, path, el, vnode) {
    var parent = el.parentNode
    var index = Array.prototype.indexOf.call(parent.childNodes, el)

    // remove the previous element and all nested components. This
    // needs to happen before we create the new element so we don't
    // get clashes on the component paths.
    removeElement(entityId, path, el)

    // then add the new element in there
    var newEl = toNative(entityId, path, vnode)
    var target = parent.childNodes[index]

    if (target) {
      parent.insertBefore(newEl, target)
    } else {
      parent.appendChild(newEl)
    }

    // walk up the tree and update all `entity.nativeElement` references.
    if (entityId !== 'root' && path === '0') {
      updateNativeElement(entityId, newEl)
    }

    return newEl
  }

  /**
   * Update all entities in a branch that have the same nativeElement. This
   * happens when a component has another component as it's root node.
   *
   * @param {String} entityId
   * @param {HTMLElement} newEl
   *
   * @return {void}
   */

  function updateNativeElement (entityId, newEl) {
    var target = entities[entityId]
    if (target.ownerId === 'root') return
    if (children[target.ownerId]['0'] === entityId) {
      entities[target.ownerId].nativeElement = newEl
      updateNativeElement(target.ownerId, newEl)
    }
  }

  /**
   * Set the attribute of an element, performing additional transformations
   * dependning on the attribute name
   *
   * @param {HTMLElement} el
   * @param {String} name
   * @param {String} value
   */

  function setAttribute (entityId, path, el, name, value) {
    if (!value) {
      removeAttribute(entityId, path, el, name)
      return
    }
    if (events[name]) {
      addEvent(entityId, path, events[name], value)
      return
    }
    switch (name) {
      case 'checked':
      case 'disabled':
      case 'selected':
        el[name] = true
        break
      case 'innerHTML':
        el.innerHTML = value
        break
      case 'value':
        setElementValue(el, value)
        break
      case svg.isAttribute(name):
        el.setAttributeNS(svg.namespace, name, value)
        break
      default:
        el.setAttribute(name, value)
        break
    }
  }

  /**
   * Remove an attribute, performing additional transformations
   * dependning on the attribute name
   *
   * @param {HTMLElement} el
   * @param {String} name
   */

  function removeAttribute (entityId, path, el, name) {
    if (events[name]) {
      removeEvent(entityId, path, events[name])
      return
    }
    switch (name) {
      case 'checked':
      case 'disabled':
      case 'selected':
        el[name] = false
        break
      case 'innerHTML':
        el.innerHTML = ''
      case 'value':
        setElementValue(el, null)
        break
      default:
        el.removeAttribute(name)
        break
    }
  }

  /**
   * Checks to see if one tree path is within
   * another tree path. Example:
   *
   * 0.1 vs 0.1.1 = true
   * 0.2 vs 0.3.5 = false
   *
   * @param {String} target
   * @param {String} path
   *
   * @return {Boolean}
   */

  function isWithinPath (target, path) {
    return path.indexOf(target + '.') === 0
  }

  /**
   * Is the DOM node an element node
   *
   * @param {HTMLElement} el
   *
   * @return {Boolean}
   */

  function isElement (el) {
    return !!(el && el.tagName)
  }

  /**
   * Remove all the child nodes from an element
   *
   * @param {HTMLElement} el
   */

  function removeAllChildren (el) {
    while (el.firstChild) el.removeChild(el.firstChild)
  }

  /**
   * Trigger a hook on a component.
   *
   * @param {String} name Name of hook.
   * @param {Entity} entity The component instance.
   * @param {Array} args To pass along to hook.
   */

  function trigger (name, entity, args) {
    if (typeof entity.component[name] !== 'function') return
    return entity.component[name].apply(null, args)
  }

  /**
   * Update an entity to match the latest rendered vode. We always
   * replace the props on the component when composing them. This
   * will trigger a re-render on all children below this point.
   *
   * @param {Entity} entity
   * @param {String} path
   * @param {Object} vnode
   *
   * @return {void}
   */

  function updateEntityProps (entityId, nextProps) {
    var entity = entities[entityId]
    entity.pendingProps = defaults({}, nextProps, entity.component.defaultProps || {})
    entity.dirty = true
    invalidate()
  }

  /**
   * Update component instance state.
   */

  function updateEntityState (entity, nextState) {
    entity.pendingState = assign(entity.pendingState, nextState)
    entity.dirty = true
    invalidate()
  }

  /**
   * Commit props and state changes to an entity.
   */

  function commit (entity) {
    entity.context = {
      state: entity.pendingState,
      props: entity.pendingProps,
      id: entity.id
    }
    entity.pendingState = assign({}, entity.context.state)
    entity.pendingProps = assign({}, entity.context.props)
    entity.dirty = false
    if (typeof entity.component.validate === 'function') {
      entity.component.validate(entity.context)
    }
  }

  /**
   * Try to avoid creating new virtual dom if possible.
   *
   * Later we may expose this so you can override, but not there yet.
   */

  function shouldUpdate (entity) {
    if (!entity.dirty) return false
    if (!entity.component.shouldUpdate) return true
    var nextProps = entity.pendingProps
    var nextState = entity.pendingState
    var bool = entity.component.shouldUpdate(entity.context, nextProps, nextState)
    return bool
  }

  /**
   * Register an entity.
   *
   * This is mostly to pre-preprocess component properties and values chains.
   *
   * The end result is for every component that gets mounted,
   * you create a set of IO nodes in the network from the `value` definitions.
   *
   * @param {Component} component
   */

  function register (entity) {
    registerEntity(entity)
    var component = entity.component
    if (component.registered) return

    // initialize sources once for a component type.
    registerSources(entity)
    component.registered = true
  }

  /**
   * Add entity to data-structures related to components/entities.
   *
   * @param {Entity} entity
   */

  function registerEntity(entity) {
    var component = entity.component
    // all entities for this component type.
    var entities = component.entities = component.entities || {}
    // add entity to component list
    entities[entity.id] = entity
    // map to component so you can remove later.
    components[entity.id] = component
  }

  /**
   * Initialize sources for a component by type.
   *
   * @param {Entity} entity
   */

  function registerSources(entity) {
    var component = components[entity.id]
    // get 'class-level' sources.
    // if we've already hooked it up, then we're good.
    var sources = component.sources
    if (sources) return
    var entities = component.entities

    // hook up sources.
    var map = component.sourceToPropertyName = {}
    component.sources = sources = []
    var propTypes = component.propTypes
    for (var name in propTypes) {
      var data = propTypes[name]
      if (!data) continue
      if (!data.source) continue
      sources.push(data.source)
      map[data.source] = name
    }

    // send value updates to all component instances.
    sources.forEach(function (source) {
      connections[source] = connections[source] || []
      connections[source].push(update)

      function update (data) {
        var prop = map[source]
        for (var entityId in entities) {
          var entity = entities[entityId]
          var changes = {}
          changes[prop] = data
          updateEntityProps(entityId, assign(entity.pendingProps, changes))
        }
      }
    })
  }

  /**
   * Set the initial source value on the entity
   *
   * @param {Entity} entity
   */

  function setSources (entity) {
    var component = entity.component
    var map = component.sourceToPropertyName
    var sources = component.sources
    sources.forEach(function (source) {
      var name = map[source]
      if (entity.pendingProps[name] != null) return
      entity.pendingProps[name] = app.sources[source] // get latest value plugged into global store
    })
  }

  /**
   * Add all of the DOM event listeners
   */

  function addNativeEventListeners () {
    forEach(events, function (eventType) {
      rootElement.addEventListener(eventType, handleEvent, true)
    })
  }

  /**
   * Add all of the DOM event listeners
   */

  function removeNativeEventListeners () {
    forEach(events, function (eventType) {
      rootElement.removeEventListener(eventType, handleEvent, true)
    })
  }

  /**
   * Handle an event that has occured within the container
   *
   * @param {Event} event
   */

  function handleEvent (event) {
    var target = event.target
    var eventType = event.type

    // Walk up the DOM tree and see if there is a handler
    // for this event type higher up.
    while (target) {
      var fn = keypath.get(handlers, [target.__entity__, target.__path__, eventType])
      if (fn) {
        event.delegateTarget = target
        if (fn(event) === false) break
      }
      target = target.parentNode
    }
  }

  /**
   * Bind events for an element, and all it's rendered child elements.
   *
   * @param {String} path
   * @param {String} event
   * @param {Function} fn
   */

  function addEvent (entityId, path, eventType, fn) {
    keypath.set(handlers, [entityId, path, eventType], function (e) {
      var entity = entities[entityId]
      if (entity) {
        return fn.call(null, e, entity.context, setState(entity))
      } else {
        return fn.call(null, e)
      }
    })
  }

  /**
   * Unbind events for a entityId
   *
   * @param {String} entityId
   */

  function removeEvent (entityId, path, eventType) {
    var args = [entityId]
    if (path) args.push(path)
    if (eventType) args.push(eventType)
    keypath.del(handlers, args)
  }

  /**
   * Unbind all events from an entity
   *
   * @param {Entity} entity
   */

  function removeAllEvents (entityId) {
    keypath.del(handlers, [entityId])
  }

  /**
   * Used for debugging to inspect the current state without
   * us needing to explicitly manage storing/updating references.
   *
   * @return {Object}
   */

  function inspect () {
    return {
      entities: entities,
      handlers: handlers,
      connections: connections,
      currentElement: currentElement,
      options: options,
      app: app,
      container: container,
      children: children
    }
  }

  /**
   * Return an object that lets us completely remove the automatic
   * DOM rendering and export debugging tools.
   */

  return {
    remove: teardown,
    inspect: inspect
  }
}

/**
 * A rendered component instance.
 *
 * This manages the lifecycle, props and state of the component.
 * It's basically just a data object for more straightfoward lookup.
 *
 * @param {Component} component
 * @param {Object} props
 */

function Entity (component, props, ownerId) {
  this.id = uid()
  this.ownerId = ownerId
  this.component = component
  this.propTypes = component.propTypes || {}
  this.context = {}
  this.context.id = this.id
  this.context.props = defaults(props || {}, component.defaultProps || {})
  this.context.state = this.component.initialState ? this.component.initialState(this.context.props) : {}
  this.pendingProps = assign({}, this.context.props)
  this.pendingState = assign({}, this.context.state)
  this.dirty = false
  this.virtualElement = null
  this.nativeElement = null
  this.displayName = component.name || 'Component'
}

/**
 * Retrieve the nearest 'body' ancestor of the given element or else the root
 * element of the document in which stands the given element.
 *
 * This is necessary if you want to attach the events handler to the correct
 * element and be able to dispatch events in document fragments such as
 * Shadow DOM.
 *
 * @param  {HTMLElement} el The element on which we will render an app.
 * @return {HTMLElement}    The root element on which we will attach the events
 *                          handler.
 */

function getRootElement (el) {
  while (el.parentElement) {
    if (el.tagName === 'BODY' || !el.parentElement) {
      return el
    }
    el = el.parentElement
  }
  return el
}

/**
 * Set the value property of an element and keep the text selection
 * for input fields.
 *
 * @param {HTMLElement} el
 * @param {String} value
 */

function setElementValue (el, value) {
  if (el === document.activeElement && canSelectText(el)) {
    var start = el.selectionStart
    var end = el.selectionEnd
    el.value = value
    el.setSelectionRange(start, end)
  } else {
    el.value = value
  }
}

/**
 * For some reason only certain types of inputs can set the selection range.
 *
 * @param {HTMLElement} el
 *
 * @return {Boolean}
 */

function canSelectText (el) {
  return el.tagName === 'INPUT' && ['text','search','password','tel','url'].indexOf(el.type) > -1
}

},{"./events":21,"./node-type":23,"./svg":26,"component-raf":28,"fast.js/forEach":32,"fast.js/object/assign":35,"fast.js/reduce":38,"get-uid":39,"is-dom":40,"object-defaults":43,"object-path":44}],25:[function(require,module,exports){
var defaults = require('object-defaults')
var nodeType = require('./node-type')
var type = require('component-type')

/**
 * Expose `stringify`.
 */

module.exports = function (app) {
  if (!app.element) {
    throw new Error('No element mounted')
  }

  /**
   * Render to string.
   *
   * @param {Component} component
   * @param {Object} [props]
   * @return {String}
   */

  function stringify (component, optProps, children) {
    var propTypes = component.propTypes || {}
    var props = defaults(optProps || {}, component.defaultProps || {})
    var state = component.initialState ? component.initialState(props) : {}
    props.children = children;

    for (var name in propTypes) {
      var options = propTypes[name]
      if (options.source) {
        props[name] = app.sources[options.source]
      }
    }

    if (component.beforeMount) component.beforeMount({ props: props, state: state })
    if (component.beforeRender) component.beforeRender({ props: props, state: state })
    var node = component.render({ props: props, state: state })
    return stringifyNode(node, '0')
  }

  /**
   * Render a node to a string
   *
   * @param {Node} node
   * @param {Tree} tree
   *
   * @return {String}
   */

  function stringifyNode (node, path) {
    switch (nodeType(node)) {
      case 'empty': return '<noscript />'
      case 'text': return node
      case 'element':
        var children = node.children
        var attributes = node.attributes
        var tagName = node.type
        var innerHTML = attributes.innerHTML
        var str = '<' + tagName + attrs(attributes) + '>'

        if (innerHTML) {
          str += innerHTML
        } else {
          for (var i = 0, n = children.length; i < n; i++) {
            str += stringifyNode(children[i], path + '.' + i)
          }
        }

        str += '</' + tagName + '>'
        return str
      case 'component': return stringify(node.type, node.attributes, node.children)
    }

    throw new Error('Invalid type')
  }

  return stringifyNode(app.element, '0')
}

/**
 * HTML attributes to string.
 *
 * @param {Object} attributes
 * @return {String}
 * @api private
 */

function attrs (attributes) {
  var str = ''
  for (var key in attributes) {
    var value = attributes[key]
    if (key === 'innerHTML') continue
    if (isValidAttributeValue(value)) str += attr(key, attributes[key])
  }
  return str
}

/**
 * HTML attribute to string.
 *
 * @param {String} key
 * @param {String} val
 * @return {String}
 * @api private
 */

function attr (key, val) {
  return ' ' + key + '="' + val + '"'
}

/**
 * Is a value able to be set a an attribute value?
 *
 * @param {Any} value
 *
 * @return {Boolean}
 */

function isValidAttributeValue (value) {
  var valueType = type(value)
  switch (valueType) {
  case 'string':
  case 'number':
    return true;

  case 'boolean':
    return value;

  default:
    return false;
  }
}

},{"./node-type":23,"component-type":29,"object-defaults":43}],26:[function(require,module,exports){
module.exports = {
  isElement: require('is-svg-element').isElement,
  isAttribute: require('is-svg-attribute'),
  namespace: 'http://www.w3.org/2000/svg'
}

},{"is-svg-attribute":41,"is-svg-element":42}],27:[function(require,module,exports){

/**
 * Expose `Emitter`.
 */

module.exports = Emitter;

/**
 * Initialize a new `Emitter`.
 *
 * @api public
 */

function Emitter(obj) {
  if (obj) return mixin(obj);
};

/**
 * Mixin the emitter properties.
 *
 * @param {Object} obj
 * @return {Object}
 * @api private
 */

function mixin(obj) {
  for (var key in Emitter.prototype) {
    obj[key] = Emitter.prototype[key];
  }
  return obj;
}

/**
 * Listen on the given `event` with `fn`.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.on =
Emitter.prototype.addEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};
  (this._callbacks['$' + event] = this._callbacks['$' + event] || [])
    .push(fn);
  return this;
};

/**
 * Adds an `event` listener that will be invoked a single
 * time then automatically removed.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.once = function(event, fn){
  function on() {
    this.off(event, on);
    fn.apply(this, arguments);
  }

  on.fn = fn;
  this.on(event, on);
  return this;
};

/**
 * Remove the given callback for `event` or all
 * registered callbacks.
 *
 * @param {String} event
 * @param {Function} fn
 * @return {Emitter}
 * @api public
 */

Emitter.prototype.off =
Emitter.prototype.removeListener =
Emitter.prototype.removeAllListeners =
Emitter.prototype.removeEventListener = function(event, fn){
  this._callbacks = this._callbacks || {};

  // all
  if (0 == arguments.length) {
    this._callbacks = {};
    return this;
  }

  // specific event
  var callbacks = this._callbacks['$' + event];
  if (!callbacks) return this;

  // remove all handlers
  if (1 == arguments.length) {
    delete this._callbacks['$' + event];
    return this;
  }

  // remove specific handler
  var cb;
  for (var i = 0; i < callbacks.length; i++) {
    cb = callbacks[i];
    if (cb === fn || cb.fn === fn) {
      callbacks.splice(i, 1);
      break;
    }
  }
  return this;
};

/**
 * Emit `event` with the given args.
 *
 * @param {String} event
 * @param {Mixed} ...
 * @return {Emitter}
 */

Emitter.prototype.emit = function(event){
  this._callbacks = this._callbacks || {};
  var args = [].slice.call(arguments, 1)
    , callbacks = this._callbacks['$' + event];

  if (callbacks) {
    callbacks = callbacks.slice(0);
    for (var i = 0, len = callbacks.length; i < len; ++i) {
      callbacks[i].apply(this, args);
    }
  }

  return this;
};

/**
 * Return array of callbacks for `event`.
 *
 * @param {String} event
 * @return {Array}
 * @api public
 */

Emitter.prototype.listeners = function(event){
  this._callbacks = this._callbacks || {};
  return this._callbacks['$' + event] || [];
};

/**
 * Check if this emitter has `event` handlers.
 *
 * @param {String} event
 * @return {Boolean}
 * @api public
 */

Emitter.prototype.hasListeners = function(event){
  return !! this.listeners(event).length;
};

},{}],28:[function(require,module,exports){
/**
 * Expose `requestAnimationFrame()`.
 */

exports = module.exports = window.requestAnimationFrame
  || window.webkitRequestAnimationFrame
  || window.mozRequestAnimationFrame
  || fallback;

/**
 * Fallback implementation.
 */

var prev = new Date().getTime();
function fallback(fn) {
  var curr = new Date().getTime();
  var ms = Math.max(0, 16 - (curr - prev));
  var req = setTimeout(fn, ms);
  prev = curr;
  return req;
}

/**
 * Cancel.
 */

var cancel = window.cancelAnimationFrame
  || window.webkitCancelAnimationFrame
  || window.mozCancelAnimationFrame
  || window.clearTimeout;

exports.cancel = function(id){
  cancel.call(window, id);
};

},{}],29:[function(require,module,exports){
(function (Buffer){
/**
 * toString ref.
 */

var toString = Object.prototype.toString;

/**
 * Return the type of `val`.
 *
 * @param {Mixed} val
 * @return {String}
 * @api public
 */

module.exports = function(val){
  switch (toString.call(val)) {
    case '[object Date]': return 'date';
    case '[object RegExp]': return 'regexp';
    case '[object Arguments]': return 'arguments';
    case '[object Array]': return 'array';
    case '[object Error]': return 'error';
  }

  if (val === null) return 'null';
  if (val === undefined) return 'undefined';
  if (val !== val) return 'nan';
  if (val && val.nodeType === 1) return 'element';

  if (typeof Buffer != 'undefined' && Buffer.isBuffer(val)) return 'buffer';

  val = val.valueOf
    ? val.valueOf()
    : Object.prototype.valueOf.apply(val)

  return typeof val;
};

}).call(this,require("buffer").Buffer)

},{"buffer":14}],30:[function(require,module,exports){
'use strict';

var bindInternal3 = require('../function/bindInternal3');

/**
 * # For Each
 *
 * A fast `.forEach()` implementation.
 *
 * @param  {Array}    subject     The array (or array-like) to iterate over.
 * @param  {Function} fn          The visitor function.
 * @param  {Object}   thisContext The context for the visitor.
 */
module.exports = function fastForEach (subject, fn, thisContext) {
  var length = subject.length,
      iterator = thisContext !== undefined ? bindInternal3(fn, thisContext) : fn,
      i;
  for (i = 0; i < length; i++) {
    iterator(subject[i], i, subject);
  }
};

},{"../function/bindInternal3":33}],31:[function(require,module,exports){
'use strict';

var bindInternal4 = require('../function/bindInternal4');

/**
 * # Reduce
 *
 * A fast `.reduce()` implementation.
 *
 * @param  {Array}    subject      The array (or array-like) to reduce.
 * @param  {Function} fn           The reducer function.
 * @param  {mixed}    initialValue The initial value for the reducer, defaults to subject[0].
 * @param  {Object}   thisContext  The context for the reducer.
 * @return {mixed}                 The final result.
 */
module.exports = function fastReduce (subject, fn, initialValue, thisContext) {
  var length = subject.length,
      iterator = thisContext !== undefined ? bindInternal4(fn, thisContext) : fn,
      i, result;

  if (initialValue === undefined) {
    i = 1;
    result = subject[0];
  }
  else {
    i = 0;
    result = initialValue;
  }

  for (; i < length; i++) {
    result = iterator(result, subject[i], i, subject);
  }

  return result;
};

},{"../function/bindInternal4":34}],32:[function(require,module,exports){
'use strict';

var forEachArray = require('./array/forEach'),
    forEachObject = require('./object/forEach');

/**
 * # ForEach
 *
 * A fast `.forEach()` implementation.
 *
 * @param  {Array|Object} subject     The array or object to iterate over.
 * @param  {Function}     fn          The visitor function.
 * @param  {Object}       thisContext The context for the visitor.
 */
module.exports = function fastForEach (subject, fn, thisContext) {
  if (subject instanceof Array) {
    return forEachArray(subject, fn, thisContext);
  }
  else {
    return forEachObject(subject, fn, thisContext);
  }
};
},{"./array/forEach":30,"./object/forEach":36}],33:[function(require,module,exports){
'use strict';

/**
 * Internal helper to bind a function known to have 3 arguments
 * to a given context.
 */
module.exports = function bindInternal3 (func, thisContext) {
  return function (a, b, c) {
    return func.call(thisContext, a, b, c);
  };
};

},{}],34:[function(require,module,exports){
'use strict';

/**
 * Internal helper to bind a function known to have 4 arguments
 * to a given context.
 */
module.exports = function bindInternal4 (func, thisContext) {
  return function (a, b, c, d) {
    return func.call(thisContext, a, b, c, d);
  };
};

},{}],35:[function(require,module,exports){
'use strict';

/**
 * Analogue of Object.assign().
 * Copies properties from one or more source objects to
 * a target object. Existing keys on the target object will be overwritten.
 *
 * > Note: This differs from spec in some important ways:
 * > 1. Will throw if passed non-objects, including `undefined` or `null` values.
 * > 2. Does not support the curious Exception handling behavior, exceptions are thrown immediately.
 * > For more details, see:
 * > https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Object/assign
 *
 *
 *
 * @param  {Object} target      The target object to copy properties to.
 * @param  {Object} source, ... The source(s) to copy properties from.
 * @return {Object}             The updated target object.
 */
module.exports = function fastAssign (target) {
  var totalArgs = arguments.length,
      source, i, totalKeys, keys, key, j;

  for (i = 1; i < totalArgs; i++) {
    source = arguments[i];
    keys = Object.keys(source);
    totalKeys = keys.length;
    for (j = 0; j < totalKeys; j++) {
      key = keys[j];
      target[key] = source[key];
    }
  }
  return target;
};

},{}],36:[function(require,module,exports){
'use strict';

var bindInternal3 = require('../function/bindInternal3');

/**
 * # For Each
 *
 * A fast object `.forEach()` implementation.
 *
 * @param  {Object}   subject     The object to iterate over.
 * @param  {Function} fn          The visitor function.
 * @param  {Object}   thisContext The context for the visitor.
 */
module.exports = function fastForEachObject (subject, fn, thisContext) {
  var keys = Object.keys(subject),
      length = keys.length,
      iterator = thisContext !== undefined ? bindInternal3(fn, thisContext) : fn,
      key, i;
  for (i = 0; i < length; i++) {
    key = keys[i];
    iterator(subject[key], key, subject);
  }
};

},{"../function/bindInternal3":33}],37:[function(require,module,exports){
'use strict';

var bindInternal4 = require('../function/bindInternal4');

/**
 * # Reduce
 *
 * A fast object `.reduce()` implementation.
 *
 * @param  {Object}   subject      The object to reduce over.
 * @param  {Function} fn           The reducer function.
 * @param  {mixed}    initialValue The initial value for the reducer, defaults to subject[0].
 * @param  {Object}   thisContext  The context for the reducer.
 * @return {mixed}                 The final result.
 */
module.exports = function fastReduceObject (subject, fn, initialValue, thisContext) {
  var keys = Object.keys(subject),
      length = keys.length,
      iterator = thisContext !== undefined ? bindInternal4(fn, thisContext) : fn,
      i, key, result;

  if (initialValue === undefined) {
    i = 1;
    result = subject[keys[0]];
  }
  else {
    i = 0;
    result = initialValue;
  }

  for (; i < length; i++) {
    key = keys[i];
    result = iterator(result, subject[key], key, subject);
  }

  return result;
};

},{"../function/bindInternal4":34}],38:[function(require,module,exports){
'use strict';

var reduceArray = require('./array/reduce'),
    reduceObject = require('./object/reduce');

/**
 * # Reduce
 *
 * A fast `.reduce()` implementation.
 *
 * @param  {Array|Object} subject      The array or object to reduce over.
 * @param  {Function}     fn           The reducer function.
 * @param  {mixed}        initialValue The initial value for the reducer, defaults to subject[0].
 * @param  {Object}       thisContext  The context for the reducer.
 * @return {Array|Object}              The array or object containing the results.
 */
module.exports = function fastReduce (subject, fn, initialValue, thisContext) {
  if (subject instanceof Array) {
    return reduceArray(subject, fn, initialValue, thisContext);
  }
  else {
    return reduceObject(subject, fn, initialValue, thisContext);
  }
};
},{"./array/reduce":31,"./object/reduce":37}],39:[function(require,module,exports){
/** generate unique id for selector */
var counter = Date.now() % 1e9;

module.exports = function getUid(){
	return (Math.random() * 1e9 >>> 0) + (counter++);
};
},{}],40:[function(require,module,exports){
/*global window*/

/**
 * Check if object is dom node.
 *
 * @param {Object} val
 * @return {Boolean}
 * @api public
 */

module.exports = function isNode(val){
  if (!val || typeof val !== 'object') return false;
  if (window && 'object' == typeof window.Node) return val instanceof window.Node;
  return 'number' == typeof val.nodeType && 'string' == typeof val.nodeName;
}

},{}],41:[function(require,module,exports){
/**
 * Supported SVG attributes
 */

exports.attributes = {
  'cx': true,
  'cy': true,
  'd': true,
  'dx': true,
  'dy': true,
  'fill': true,
  'fillOpacity': true,
  'fontFamily': true,
  'fontSize': true,
  'fx': true,
  'fy': true,
  'gradientTransform': true,
  'gradientUnits': true,
  'markerEnd': true,
  'markerMid': true,
  'markerStart': true,
  'offset': true,
  'opacity': true,
  'patternContentUnits': true,
  'patternUnits': true,
  'points': true,
  'preserveAspectRatio': true,
  'r': true,
  'rx': true,
  'ry': true,
  'spreadMethod': true,
  'stopColor': true,
  'stopOpacity': true,
  'stroke': true,
  'strokeDasharray': true,
  'strokeLinecap': true,
  'strokeOpacity': true,
  'strokeWidth': true,
  'textAnchor': true,
  'transform': true,
  'version': true,
  'viewBox': true,
  'x1': true,
  'x2': true,
  'x': true,
  'y1': true,
  'y2': true,
  'y': true
}

/**
 * Are element's attributes SVG?
 *
 * @param {String} attr
 */

module.exports = function (attr) {
  return attr in exports.attributes
}

},{}],42:[function(require,module,exports){
/**
 * Supported SVG elements
 *
 * @type {Array}
 */

exports.elements = {
  'animate': true,
  'circle': true,
  'defs': true,
  'ellipse': true,
  'g': true,
  'line': true,
  'linearGradient': true,
  'mask': true,
  'path': true,
  'pattern': true,
  'polygon': true,
  'polyline': true,
  'radialGradient': true,
  'rect': true,
  'stop': true,
  'svg': true,
  'text': true,
  'tspan': true
}

/**
 * Is element's namespace SVG?
 *
 * @param {String} name
 */

exports.isElement = function (name) {
  return name in exports.elements
}

},{}],43:[function(require,module,exports){
'use strict'

module.exports = function(target) {
  target = target || {}

  for (var i = 1; i < arguments.length; i++) {
    var source = arguments[i]
    if (!source) continue

    Object.getOwnPropertyNames(source).forEach(function(key) {
      if (undefined === target[key])
        target[key] = source[key]
    })
  }

  return target
}

},{}],44:[function(require,module,exports){
(function (root, factory){
  'use strict';

  /*istanbul ignore next:cant test*/
  if (typeof module === 'object' && typeof module.exports === 'object') {
    module.exports = factory();
  } else if (typeof define === 'function' && define.amd) {
    // AMD. Register as an anonymous module.
    define([], factory);
  } else {
    // Browser globals
    root.objectPath = factory();
  }
})(this, function(){
  'use strict';

  var
    toStr = Object.prototype.toString,
    _hasOwnProperty = Object.prototype.hasOwnProperty;

  function isEmpty(value){
    if (!value) {
      return true;
    }
    if (isArray(value) && value.length === 0) {
        return true;
    } else if (!isString(value)) {
        for (var i in value) {
            if (_hasOwnProperty.call(value, i)) {
                return false;
            }
        }
        return true;
    }
    return false;
  }

  function toString(type){
    return toStr.call(type);
  }

  function isNumber(value){
    return typeof value === 'number' || toString(value) === "[object Number]";
  }

  function isString(obj){
    return typeof obj === 'string' || toString(obj) === "[object String]";
  }

  function isObject(obj){
    return typeof obj === 'object' && toString(obj) === "[object Object]";
  }

  function isArray(obj){
    return typeof obj === 'object' && typeof obj.length === 'number' && toString(obj) === '[object Array]';
  }

  function isBoolean(obj){
    return typeof obj === 'boolean' || toString(obj) === '[object Boolean]';
  }

  function getKey(key){
    var intKey = parseInt(key);
    if (intKey.toString() === key) {
      return intKey;
    }
    return key;
  }

  function set(obj, path, value, doNotReplace){
    if (isNumber(path)) {
      path = [path];
    }
    if (isEmpty(path)) {
      return obj;
    }
    if (isString(path)) {
      return set(obj, path.split('.').map(getKey), value, doNotReplace);
    }
    var currentPath = path[0];

    if (path.length === 1) {
      var oldVal = obj[currentPath];
      if (oldVal === void 0 || !doNotReplace) {
        obj[currentPath] = value;
      }
      return oldVal;
    }

    if (obj[currentPath] === void 0) {
      //check if we assume an array
      if(isNumber(path[1])) {
        obj[currentPath] = [];
      } else {
        obj[currentPath] = {};
      }
    }

    return set(obj[currentPath], path.slice(1), value, doNotReplace);
  }

  function del(obj, path) {
    if (isNumber(path)) {
      path = [path];
    }

    if (isEmpty(obj)) {
      return void 0;
    }

    if (isEmpty(path)) {
      return obj;
    }
    if(isString(path)) {
      return del(obj, path.split('.'));
    }

    var currentPath = getKey(path[0]);
    var oldVal = obj[currentPath];

    if(path.length === 1) {
      if (oldVal !== void 0) {
        if (isArray(obj)) {
          obj.splice(currentPath, 1);
        } else {
          delete obj[currentPath];
        }
      }
    } else {
      if (obj[currentPath] !== void 0) {
        return del(obj[currentPath], path.slice(1));
      }
    }

    return obj;
  }

  var objectPath = function(obj) {
    return Object.keys(objectPath).reduce(function(proxy, prop) {
      if (typeof objectPath[prop] === 'function') {
        proxy[prop] = objectPath[prop].bind(objectPath, obj);
      }

      return proxy;
    }, {});
  };

  objectPath.has = function (obj, path) {
    if (isEmpty(obj)) {
      return false;
    }

    if (isNumber(path)) {
      path = [path];
    } else if (isString(path)) {
      path = path.split('.');
    }

    if (isEmpty(path) || path.length === 0) {
      return false;
    }

    for (var i = 0; i < path.length; i++) {
      var j = path[i];
      if ((isObject(obj) || isArray(obj)) && _hasOwnProperty.call(obj, j)) {
        obj = obj[j];
      } else {
        return false;
      }
    }

    return true;
  };

  objectPath.ensureExists = function (obj, path, value){
    return set(obj, path, value, true);
  };

  objectPath.set = function (obj, path, value, doNotReplace){
    return set(obj, path, value, doNotReplace);
  };

  objectPath.insert = function (obj, path, value, at){
    var arr = objectPath.get(obj, path);
    at = ~~at;
    if (!isArray(arr)) {
      arr = [];
      objectPath.set(obj, path, arr);
    }
    arr.splice(at, 0, value);
  };

  objectPath.empty = function(obj, path) {
    if (isEmpty(path)) {
      return obj;
    }
    if (isEmpty(obj)) {
      return void 0;
    }

    var value, i;
    if (!(value = objectPath.get(obj, path))) {
      return obj;
    }

    if (isString(value)) {
      return objectPath.set(obj, path, '');
    } else if (isBoolean(value)) {
      return objectPath.set(obj, path, false);
    } else if (isNumber(value)) {
      return objectPath.set(obj, path, 0);
    } else if (isArray(value)) {
      value.length = 0;
    } else if (isObject(value)) {
      for (i in value) {
        if (_hasOwnProperty.call(value, i)) {
          delete value[i];
        }
      }
    } else {
      return objectPath.set(obj, path, null);
    }
  };

  objectPath.push = function (obj, path /*, values */){
    var arr = objectPath.get(obj, path);
    if (!isArray(arr)) {
      arr = [];
      objectPath.set(obj, path, arr);
    }

    arr.push.apply(arr, Array.prototype.slice.call(arguments, 2));
  };

  objectPath.coalesce = function (obj, paths, defaultValue) {
    var value;

    for (var i = 0, len = paths.length; i < len; i++) {
      if ((value = objectPath.get(obj, paths[i])) !== void 0) {
        return value;
      }
    }

    return defaultValue;
  };

  objectPath.get = function (obj, path, defaultValue){
    if (isNumber(path)) {
      path = [path];
    }
    if (isEmpty(path)) {
      return obj;
    }
    if (isEmpty(obj)) {
      return defaultValue;
    }
    if (isString(path)) {
      return objectPath.get(obj, path.split('.'), defaultValue);
    }

    var currentPath = getKey(path[0]);

    if (path.length === 1) {
      if (obj[currentPath] === void 0) {
        return defaultValue;
      }
      return obj[currentPath];
    }

    return objectPath.get(obj[currentPath], path.slice(1), defaultValue);
  };

  objectPath.del = function(obj, path) {
    return del(obj, path);
  };

  return objectPath;
});

},{}],45:[function(require,module,exports){


//
// Generated on Tue Dec 16 2014 12:13:47 GMT+0100 (CET) by Charlie Robbins, Paolo Fragomeni & the Contributors (Using Codesurgeon).
// Version 1.2.6
//

(function (exports) {

/*
 * browser.js: Browser specific functionality for director.
 *
 * (C) 2011, Charlie Robbins, Paolo Fragomeni, & the Contributors.
 * MIT LICENSE
 *
 */

var dloc = document.location;

function dlocHashEmpty() {
  // Non-IE browsers return '' when the address bar shows '#'; Director's logic
  // assumes both mean empty.
  return dloc.hash === '' || dloc.hash === '#';
}

var listener = {
  mode: 'modern',
  hash: dloc.hash,
  history: false,

  check: function () {
    var h = dloc.hash;
    if (h != this.hash) {
      this.hash = h;
      this.onHashChanged();
    }
  },

  fire: function () {
    if (this.mode === 'modern') {
      this.history === true ? window.onpopstate() : window.onhashchange();
    }
    else {
      this.onHashChanged();
    }
  },

  init: function (fn, history) {
    var self = this;
    this.history = history;

    if (!Router.listeners) {
      Router.listeners = [];
    }

    function onchange(onChangeEvent) {
      for (var i = 0, l = Router.listeners.length; i < l; i++) {
        Router.listeners[i](onChangeEvent);
      }
    }

    //note IE8 is being counted as 'modern' because it has the hashchange event
    if ('onhashchange' in window && (document.documentMode === undefined
      || document.documentMode > 7)) {
      // At least for now HTML5 history is available for 'modern' browsers only
      if (this.history === true) {
        // There is an old bug in Chrome that causes onpopstate to fire even
        // upon initial page load. Since the handler is run manually in init(),
        // this would cause Chrome to run it twise. Currently the only
        // workaround seems to be to set the handler after the initial page load
        // http://code.google.com/p/chromium/issues/detail?id=63040
        setTimeout(function() {
          window.onpopstate = onchange;
        }, 500);
      }
      else {
        window.onhashchange = onchange;
      }
      this.mode = 'modern';
    }
    else {
      //
      // IE support, based on a concept by Erik Arvidson ...
      //
      var frame = document.createElement('iframe');
      frame.id = 'state-frame';
      frame.style.display = 'none';
      document.body.appendChild(frame);
      this.writeFrame('');

      if ('onpropertychange' in document && 'attachEvent' in document) {
        document.attachEvent('onpropertychange', function () {
          if (event.propertyName === 'location') {
            self.check();
          }
        });
      }

      window.setInterval(function () { self.check(); }, 50);

      this.onHashChanged = onchange;
      this.mode = 'legacy';
    }

    Router.listeners.push(fn);

    return this.mode;
  },

  destroy: function (fn) {
    if (!Router || !Router.listeners) {
      return;
    }

    var listeners = Router.listeners;

    for (var i = listeners.length - 1; i >= 0; i--) {
      if (listeners[i] === fn) {
        listeners.splice(i, 1);
      }
    }
  },

  setHash: function (s) {
    // Mozilla always adds an entry to the history
    if (this.mode === 'legacy') {
      this.writeFrame(s);
    }

    if (this.history === true) {
      window.history.pushState({}, document.title, s);
      // Fire an onpopstate event manually since pushing does not obviously
      // trigger the pop event.
      this.fire();
    } else {
      dloc.hash = (s[0] === '/') ? s : '/' + s;
    }
    return this;
  },

  writeFrame: function (s) {
    // IE support...
    var f = document.getElementById('state-frame');
    var d = f.contentDocument || f.contentWindow.document;
    d.open();
    d.write("<script>_hash = '" + s + "'; onload = parent.listener.syncHash;<script>");
    d.close();
  },

  syncHash: function () {
    // IE support...
    var s = this._hash;
    if (s != dloc.hash) {
      dloc.hash = s;
    }
    return this;
  },

  onHashChanged: function () {}
};

var Router = exports.Router = function (routes) {
  if (!(this instanceof Router)) return new Router(routes);

  this.params   = {};
  this.routes   = {};
  this.methods  = ['on', 'once', 'after', 'before'];
  this.scope    = [];
  this._methods = {};

  this._insert = this.insert;
  this.insert = this.insertEx;

  this.historySupport = (window.history != null ? window.history.pushState : null) != null

  this.configure();
  this.mount(routes || {});
};

Router.prototype.init = function (r) {
  var self = this
    , routeTo;
  this.handler = function(onChangeEvent) {
    var newURL = onChangeEvent && onChangeEvent.newURL || window.location.hash;
    var url = self.history === true ? self.getPath() : newURL.replace(/.*#/, '');
    self.dispatch('on', url.charAt(0) === '/' ? url : '/' + url);
  };

  listener.init(this.handler, this.history);

  if (this.history === false) {
    if (dlocHashEmpty() && r) {
      dloc.hash = r;
    } else if (!dlocHashEmpty()) {
      self.dispatch('on', '/' + dloc.hash.replace(/^(#\/|#|\/)/, ''));
    }
  }
  else {
    if (this.convert_hash_in_init) {
      // Use hash as route
      routeTo = dlocHashEmpty() && r ? r : !dlocHashEmpty() ? dloc.hash.replace(/^#/, '') : null;
      if (routeTo) {
        window.history.replaceState({}, document.title, routeTo);
      }
    }
    else {
      // Use canonical url
      routeTo = this.getPath();
    }

    // Router has been initialized, but due to the chrome bug it will not
    // yet actually route HTML5 history state changes. Thus, decide if should route.
    if (routeTo || this.run_in_init === true) {
      this.handler();
    }
  }

  return this;
};

Router.prototype.explode = function () {
  var v = this.history === true ? this.getPath() : dloc.hash;
  if (v.charAt(1) === '/') { v=v.slice(1) }
  return v.slice(1, v.length).split("/");
};

Router.prototype.setRoute = function (i, v, val) {
  var url = this.explode();

  if (typeof i === 'number' && typeof v === 'string') {
    url[i] = v;
  }
  else if (typeof val === 'string') {
    url.splice(i, v, s);
  }
  else {
    url = [i];
  }

  listener.setHash(url.join('/'));
  return url;
};

//
// ### function insertEx(method, path, route, parent)
// #### @method {string} Method to insert the specific `route`.
// #### @path {Array} Parsed path to insert the `route` at.
// #### @route {Array|function} Route handlers to insert.
// #### @parent {Object} **Optional** Parent "routes" to insert into.
// insert a callback that will only occur once per the matched route.
//
Router.prototype.insertEx = function(method, path, route, parent) {
  if (method === "once") {
    method = "on";
    route = function(route) {
      var once = false;
      return function() {
        if (once) return;
        once = true;
        return route.apply(this, arguments);
      };
    }(route);
  }
  return this._insert(method, path, route, parent);
};

Router.prototype.getRoute = function (v) {
  var ret = v;

  if (typeof v === "number") {
    ret = this.explode()[v];
  }
  else if (typeof v === "string"){
    var h = this.explode();
    ret = h.indexOf(v);
  }
  else {
    ret = this.explode();
  }

  return ret;
};

Router.prototype.destroy = function () {
  listener.destroy(this.handler);
  return this;
};

Router.prototype.getPath = function () {
  var path = window.location.pathname;
  if (path.substr(0, 1) !== '/') {
    path = '/' + path;
  }
  return path;
};
function _every(arr, iterator) {
  for (var i = 0; i < arr.length; i += 1) {
    if (iterator(arr[i], i, arr) === false) {
      return;
    }
  }
}

function _flatten(arr) {
  var flat = [];
  for (var i = 0, n = arr.length; i < n; i++) {
    flat = flat.concat(arr[i]);
  }
  return flat;
}

function _asyncEverySeries(arr, iterator, callback) {
  if (!arr.length) {
    return callback();
  }
  var completed = 0;
  (function iterate() {
    iterator(arr[completed], function(err) {
      if (err || err === false) {
        callback(err);
        callback = function() {};
      } else {
        completed += 1;
        if (completed === arr.length) {
          callback();
        } else {
          iterate();
        }
      }
    });
  })();
}

function paramifyString(str, params, mod) {
  mod = str;
  for (var param in params) {
    if (params.hasOwnProperty(param)) {
      mod = params[param](str);
      if (mod !== str) {
        break;
      }
    }
  }
  return mod === str ? "([._a-zA-Z0-9-%()]+)" : mod;
}

function regifyString(str, params) {
  var matches, last = 0, out = "";
  while (matches = str.substr(last).match(/[^\w\d\- %@&]*\*[^\w\d\- %@&]*/)) {
    last = matches.index + matches[0].length;
    matches[0] = matches[0].replace(/^\*/, "([_.()!\\ %@&a-zA-Z0-9-]+)");
    out += str.substr(0, matches.index) + matches[0];
  }
  str = out += str.substr(last);
  var captures = str.match(/:([^\/]+)/ig), capture, length;
  if (captures) {
    length = captures.length;
    for (var i = 0; i < length; i++) {
      capture = captures[i];
      if (capture.slice(0, 2) === "::") {
        str = capture.slice(1);
      } else {
        str = str.replace(capture, paramifyString(capture, params));
      }
    }
  }
  return str;
}

function terminator(routes, delimiter, start, stop) {
  var last = 0, left = 0, right = 0, start = (start || "(").toString(), stop = (stop || ")").toString(), i;
  for (i = 0; i < routes.length; i++) {
    var chunk = routes[i];
    if (chunk.indexOf(start, last) > chunk.indexOf(stop, last) || ~chunk.indexOf(start, last) && !~chunk.indexOf(stop, last) || !~chunk.indexOf(start, last) && ~chunk.indexOf(stop, last)) {
      left = chunk.indexOf(start, last);
      right = chunk.indexOf(stop, last);
      if (~left && !~right || !~left && ~right) {
        var tmp = routes.slice(0, (i || 1) + 1).join(delimiter);
        routes = [ tmp ].concat(routes.slice((i || 1) + 1));
      }
      last = (right > left ? right : left) + 1;
      i = 0;
    } else {
      last = 0;
    }
  }
  return routes;
}

var QUERY_SEPARATOR = /\?.*/;

Router.prototype.configure = function(options) {
  options = options || {};
  for (var i = 0; i < this.methods.length; i++) {
    this._methods[this.methods[i]] = true;
  }
  this.recurse = options.recurse || this.recurse || false;
  this.async = options.async || false;
  this.delimiter = options.delimiter || "/";
  this.strict = typeof options.strict === "undefined" ? true : options.strict;
  this.notfound = options.notfound;
  this.resource = options.resource;
  this.history = options.html5history && this.historySupport || false;
  this.run_in_init = this.history === true && options.run_handler_in_init !== false;
  this.convert_hash_in_init = this.history === true && options.convert_hash_in_init !== false;
  this.every = {
    after: options.after || null,
    before: options.before || null,
    on: options.on || null
  };
  return this;
};

Router.prototype.param = function(token, matcher) {
  if (token[0] !== ":") {
    token = ":" + token;
  }
  var compiled = new RegExp(token, "g");
  this.params[token] = function(str) {
    return str.replace(compiled, matcher.source || matcher);
  };
  return this;
};

Router.prototype.on = Router.prototype.route = function(method, path, route) {
  var self = this;
  if (!route && typeof path == "function") {
    route = path;
    path = method;
    method = "on";
  }
  if (Array.isArray(path)) {
    return path.forEach(function(p) {
      self.on(method, p, route);
    });
  }
  if (path.source) {
    path = path.source.replace(/\\\//ig, "/");
  }
  if (Array.isArray(method)) {
    return method.forEach(function(m) {
      self.on(m.toLowerCase(), path, route);
    });
  }
  path = path.split(new RegExp(this.delimiter));
  path = terminator(path, this.delimiter);
  this.insert(method, this.scope.concat(path), route);
};

Router.prototype.path = function(path, routesFn) {
  var self = this, length = this.scope.length;
  if (path.source) {
    path = path.source.replace(/\\\//ig, "/");
  }
  path = path.split(new RegExp(this.delimiter));
  path = terminator(path, this.delimiter);
  this.scope = this.scope.concat(path);
  routesFn.call(this, this);
  this.scope.splice(length, path.length);
};

Router.prototype.dispatch = function(method, path, callback) {
  var self = this, fns = this.traverse(method, path.replace(QUERY_SEPARATOR, ""), this.routes, ""), invoked = this._invoked, after;
  this._invoked = true;
  if (!fns || fns.length === 0) {
    this.last = [];
    if (typeof this.notfound === "function") {
      this.invoke([ this.notfound ], {
        method: method,
        path: path
      }, callback);
    }
    return false;
  }
  if (this.recurse === "forward") {
    fns = fns.reverse();
  }
  function updateAndInvoke() {
    self.last = fns.after;
    self.invoke(self.runlist(fns), self, callback);
  }
  after = this.every && this.every.after ? [ this.every.after ].concat(this.last) : [ this.last ];
  if (after && after.length > 0 && invoked) {
    if (this.async) {
      this.invoke(after, this, updateAndInvoke);
    } else {
      this.invoke(after, this);
      updateAndInvoke();
    }
    return true;
  }
  updateAndInvoke();
  return true;
};

Router.prototype.invoke = function(fns, thisArg, callback) {
  var self = this;
  var apply;
  if (this.async) {
    apply = function(fn, next) {
      if (Array.isArray(fn)) {
        return _asyncEverySeries(fn, apply, next);
      } else if (typeof fn == "function") {
        fn.apply(thisArg, (fns.captures || []).concat(next));
      }
    };
    _asyncEverySeries(fns, apply, function() {
      if (callback) {
        callback.apply(thisArg, arguments);
      }
    });
  } else {
    apply = function(fn) {
      if (Array.isArray(fn)) {
        return _every(fn, apply);
      } else if (typeof fn === "function") {
        return fn.apply(thisArg, fns.captures || []);
      } else if (typeof fn === "string" && self.resource) {
        self.resource[fn].apply(thisArg, fns.captures || []);
      }
    };
    _every(fns, apply);
  }
};

Router.prototype.traverse = function(method, path, routes, regexp, filter) {
  var fns = [], current, exact, match, next, that;
  function filterRoutes(routes) {
    if (!filter) {
      return routes;
    }
    function deepCopy(source) {
      var result = [];
      for (var i = 0; i < source.length; i++) {
        result[i] = Array.isArray(source[i]) ? deepCopy(source[i]) : source[i];
      }
      return result;
    }
    function applyFilter(fns) {
      for (var i = fns.length - 1; i >= 0; i--) {
        if (Array.isArray(fns[i])) {
          applyFilter(fns[i]);
          if (fns[i].length === 0) {
            fns.splice(i, 1);
          }
        } else {
          if (!filter(fns[i])) {
            fns.splice(i, 1);
          }
        }
      }
    }
    var newRoutes = deepCopy(routes);
    newRoutes.matched = routes.matched;
    newRoutes.captures = routes.captures;
    newRoutes.after = routes.after.filter(filter);
    applyFilter(newRoutes);
    return newRoutes;
  }
  if (path === this.delimiter && routes[method]) {
    next = [ [ routes.before, routes[method] ].filter(Boolean) ];
    next.after = [ routes.after ].filter(Boolean);
    next.matched = true;
    next.captures = [];
    return filterRoutes(next);
  }
  for (var r in routes) {
    if (routes.hasOwnProperty(r) && (!this._methods[r] || this._methods[r] && typeof routes[r] === "object" && !Array.isArray(routes[r]))) {
      current = exact = regexp + this.delimiter + r;
      if (!this.strict) {
        exact += "[" + this.delimiter + "]?";
      }
      match = path.match(new RegExp("^" + exact));
      if (!match) {
        continue;
      }
      if (match[0] && match[0] == path && routes[r][method]) {
        next = [ [ routes[r].before, routes[r][method] ].filter(Boolean) ];
        next.after = [ routes[r].after ].filter(Boolean);
        next.matched = true;
        next.captures = match.slice(1);
        if (this.recurse && routes === this.routes) {
          next.push([ routes.before, routes.on ].filter(Boolean));
          next.after = next.after.concat([ routes.after ].filter(Boolean));
        }
        return filterRoutes(next);
      }
      next = this.traverse(method, path, routes[r], current);
      if (next.matched) {
        if (next.length > 0) {
          fns = fns.concat(next);
        }
        if (this.recurse) {
          fns.push([ routes[r].before, routes[r].on ].filter(Boolean));
          next.after = next.after.concat([ routes[r].after ].filter(Boolean));
          if (routes === this.routes) {
            fns.push([ routes["before"], routes["on"] ].filter(Boolean));
            next.after = next.after.concat([ routes["after"] ].filter(Boolean));
          }
        }
        fns.matched = true;
        fns.captures = next.captures;
        fns.after = next.after;
        return filterRoutes(fns);
      }
    }
  }
  return false;
};

Router.prototype.insert = function(method, path, route, parent) {
  var methodType, parentType, isArray, nested, part;
  path = path.filter(function(p) {
    return p && p.length > 0;
  });
  parent = parent || this.routes;
  part = path.shift();
  if (/\:|\*/.test(part) && !/\\d|\\w/.test(part)) {
    part = regifyString(part, this.params);
  }
  if (path.length > 0) {
    parent[part] = parent[part] || {};
    return this.insert(method, path, route, parent[part]);
  }
  if (!part && !path.length && parent === this.routes) {
    methodType = typeof parent[method];
    switch (methodType) {
     case "function":
      parent[method] = [ parent[method], route ];
      return;
     case "object":
      parent[method].push(route);
      return;
     case "undefined":
      parent[method] = route;
      return;
    }
    return;
  }
  parentType = typeof parent[part];
  isArray = Array.isArray(parent[part]);
  if (parent[part] && !isArray && parentType == "object") {
    methodType = typeof parent[part][method];
    switch (methodType) {
     case "function":
      parent[part][method] = [ parent[part][method], route ];
      return;
     case "object":
      parent[part][method].push(route);
      return;
     case "undefined":
      parent[part][method] = route;
      return;
    }
  } else if (parentType == "undefined") {
    nested = {};
    nested[method] = route;
    parent[part] = nested;
    return;
  }
  throw new Error("Invalid route context: " + parentType);
};



Router.prototype.extend = function(methods) {
  var self = this, len = methods.length, i;
  function extend(method) {
    self._methods[method] = true;
    self[method] = function() {
      var extra = arguments.length === 1 ? [ method, "" ] : [ method ];
      self.on.apply(self, extra.concat(Array.prototype.slice.call(arguments)));
    };
  }
  for (i = 0; i < len; i++) {
    extend(methods[i]);
  }
};

Router.prototype.runlist = function(fns) {
  var runlist = this.every && this.every.before ? [ this.every.before ].concat(_flatten(fns)) : _flatten(fns);
  if (this.every && this.every.on) {
    runlist.push(this.every.on);
  }
  runlist.captures = fns.captures;
  runlist.source = fns.source;
  return runlist;
};

Router.prototype.mount = function(routes, path) {
  if (!routes || typeof routes !== "object" || Array.isArray(routes)) {
    return;
  }
  var self = this;
  path = path || [];
  if (!Array.isArray(path)) {
    path = path.split(self.delimiter);
  }
  function insertOrMount(route, local) {
    var rename = route, parts = route.split(self.delimiter), routeType = typeof routes[route], isRoute = parts[0] === "" || !self._methods[parts[0]], event = isRoute ? "on" : rename;
    if (isRoute) {
      rename = rename.slice((rename.match(new RegExp("^" + self.delimiter)) || [ "" ])[0].length);
      parts.shift();
    }
    if (isRoute && routeType === "object" && !Array.isArray(routes[route])) {
      local = local.concat(parts);
      self.mount(routes[route], local);
      return;
    }
    if (isRoute) {
      local = local.concat(rename.split(self.delimiter));
      local = terminator(local, self.delimiter);
    }
    self.insert(event, local, routes[route]);
  }
  for (var route in routes) {
    if (routes.hasOwnProperty(route)) {
      insertOrMount(route, path.slice(0));
    }
  }
};



}(typeof exports === "object" ? exports : window));
},{}],46:[function(require,module,exports){
/**
 * Copyright (c) 2014-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

module.exports.Dispatcher = require('./lib/Dispatcher');

},{"./lib/Dispatcher":47}],47:[function(require,module,exports){
(function (process){
/**
 * Copyright (c) 2014-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule Dispatcher
 * 
 * @preventMunge
 */

'use strict';

exports.__esModule = true;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var invariant = require('fbjs/lib/invariant');

var _prefix = 'ID_';

/**
 * Dispatcher is used to broadcast payloads to registered callbacks. This is
 * different from generic pub-sub systems in two ways:
 *
 *   1) Callbacks are not subscribed to particular events. Every payload is
 *      dispatched to every registered callback.
 *   2) Callbacks can be deferred in whole or part until other callbacks have
 *      been executed.
 *
 * For example, consider this hypothetical flight destination form, which
 * selects a default city when a country is selected:
 *
 *   var flightDispatcher = new Dispatcher();
 *
 *   // Keeps track of which country is selected
 *   var CountryStore = {country: null};
 *
 *   // Keeps track of which city is selected
 *   var CityStore = {city: null};
 *
 *   // Keeps track of the base flight price of the selected city
 *   var FlightPriceStore = {price: null}
 *
 * When a user changes the selected city, we dispatch the payload:
 *
 *   flightDispatcher.dispatch({
 *     actionType: 'city-update',
 *     selectedCity: 'paris'
 *   });
 *
 * This payload is digested by `CityStore`:
 *
 *   flightDispatcher.register(function(payload) {
 *     if (payload.actionType === 'city-update') {
 *       CityStore.city = payload.selectedCity;
 *     }
 *   });
 *
 * When the user selects a country, we dispatch the payload:
 *
 *   flightDispatcher.dispatch({
 *     actionType: 'country-update',
 *     selectedCountry: 'australia'
 *   });
 *
 * This payload is digested by both stores:
 *
 *   CountryStore.dispatchToken = flightDispatcher.register(function(payload) {
 *     if (payload.actionType === 'country-update') {
 *       CountryStore.country = payload.selectedCountry;
 *     }
 *   });
 *
 * When the callback to update `CountryStore` is registered, we save a reference
 * to the returned token. Using this token with `waitFor()`, we can guarantee
 * that `CountryStore` is updated before the callback that updates `CityStore`
 * needs to query its data.
 *
 *   CityStore.dispatchToken = flightDispatcher.register(function(payload) {
 *     if (payload.actionType === 'country-update') {
 *       // `CountryStore.country` may not be updated.
 *       flightDispatcher.waitFor([CountryStore.dispatchToken]);
 *       // `CountryStore.country` is now guaranteed to be updated.
 *
 *       // Select the default city for the new country
 *       CityStore.city = getDefaultCityForCountry(CountryStore.country);
 *     }
 *   });
 *
 * The usage of `waitFor()` can be chained, for example:
 *
 *   FlightPriceStore.dispatchToken =
 *     flightDispatcher.register(function(payload) {
 *       switch (payload.actionType) {
 *         case 'country-update':
 *         case 'city-update':
 *           flightDispatcher.waitFor([CityStore.dispatchToken]);
 *           FlightPriceStore.price =
 *             getFlightPriceStore(CountryStore.country, CityStore.city);
 *           break;
 *     }
 *   });
 *
 * The `country-update` payload will be guaranteed to invoke the stores'
 * registered callbacks in order: `CountryStore`, `CityStore`, then
 * `FlightPriceStore`.
 */

var Dispatcher = (function () {
  function Dispatcher() {
    _classCallCheck(this, Dispatcher);

    this._callbacks = {};
    this._isDispatching = false;
    this._isHandled = {};
    this._isPending = {};
    this._lastID = 1;
  }

  /**
   * Registers a callback to be invoked with every dispatched payload. Returns
   * a token that can be used with `waitFor()`.
   */

  Dispatcher.prototype.register = function register(callback) {
    var id = _prefix + this._lastID++;
    this._callbacks[id] = callback;
    return id;
  };

  /**
   * Removes a callback based on its token.
   */

  Dispatcher.prototype.unregister = function unregister(id) {
    !this._callbacks[id] ? process.env.NODE_ENV !== 'production' ? invariant(false, 'Dispatcher.unregister(...): `%s` does not map to a registered callback.', id) : invariant(false) : undefined;
    delete this._callbacks[id];
  };

  /**
   * Waits for the callbacks specified to be invoked before continuing execution
   * of the current callback. This method should only be used by a callback in
   * response to a dispatched payload.
   */

  Dispatcher.prototype.waitFor = function waitFor(ids) {
    !this._isDispatching ? process.env.NODE_ENV !== 'production' ? invariant(false, 'Dispatcher.waitFor(...): Must be invoked while dispatching.') : invariant(false) : undefined;
    for (var ii = 0; ii < ids.length; ii++) {
      var id = ids[ii];
      if (this._isPending[id]) {
        !this._isHandled[id] ? process.env.NODE_ENV !== 'production' ? invariant(false, 'Dispatcher.waitFor(...): Circular dependency detected while ' + 'waiting for `%s`.', id) : invariant(false) : undefined;
        continue;
      }
      !this._callbacks[id] ? process.env.NODE_ENV !== 'production' ? invariant(false, 'Dispatcher.waitFor(...): `%s` does not map to a registered callback.', id) : invariant(false) : undefined;
      this._invokeCallback(id);
    }
  };

  /**
   * Dispatches a payload to all registered callbacks.
   */

  Dispatcher.prototype.dispatch = function dispatch(payload) {
    !!this._isDispatching ? process.env.NODE_ENV !== 'production' ? invariant(false, 'Dispatch.dispatch(...): Cannot dispatch in the middle of a dispatch.') : invariant(false) : undefined;
    this._startDispatching(payload);
    try {
      for (var id in this._callbacks) {
        if (this._isPending[id]) {
          continue;
        }
        this._invokeCallback(id);
      }
    } finally {
      this._stopDispatching();
    }
  };

  /**
   * Is this Dispatcher currently dispatching.
   */

  Dispatcher.prototype.isDispatching = function isDispatching() {
    return this._isDispatching;
  };

  /**
   * Call the callback stored with the given id. Also do some internal
   * bookkeeping.
   *
   * @internal
   */

  Dispatcher.prototype._invokeCallback = function _invokeCallback(id) {
    this._isPending[id] = true;
    this._callbacks[id](this._pendingPayload);
    this._isHandled[id] = true;
  };

  /**
   * Set up bookkeeping needed when dispatching.
   *
   * @internal
   */

  Dispatcher.prototype._startDispatching = function _startDispatching(payload) {
    for (var id in this._callbacks) {
      this._isPending[id] = false;
      this._isHandled[id] = false;
    }
    this._pendingPayload = payload;
    this._isDispatching = true;
  };

  /**
   * Clear bookkeeping used for dispatching.
   *
   * @internal
   */

  Dispatcher.prototype._stopDispatching = function _stopDispatching() {
    delete this._pendingPayload;
    this._isDispatching = false;
  };

  return Dispatcher;
})();

module.exports = Dispatcher;
}).call(this,require('_process'))

},{"_process":19,"fbjs/lib/invariant":48}],48:[function(require,module,exports){
(function (process){
/**
 * Copyright 2013-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 *
 * @providesModule invariant
 */

"use strict";

/**
 * Use invariant() to assert state which your program assumes to be true.
 *
 * Provide sprintf-style format (only %s is supported) and arguments
 * to provide information about what broke and what you were
 * expecting.
 *
 * The invariant message will be stripped in production, but the invariant
 * will remain to ensure logic does not differ in production.
 */

var invariant = function (condition, format, a, b, c, d, e, f) {
  if (process.env.NODE_ENV !== 'production') {
    if (format === undefined) {
      throw new Error('invariant requires an error message argument');
    }
  }

  if (!condition) {
    var error;
    if (format === undefined) {
      error = new Error('Minified exception occurred; use the non-minified dev environment ' + 'for the full error message and additional helpful warnings.');
    } else {
      var args = [a, b, c, d, e, f];
      var argIndex = 0;
      error = new Error('Invariant Violation: ' + format.replace(/%s/g, function () {
        return args[argIndex++];
      }));
    }

    error.framesToPop = 1; // we don't care about invariant's own frame
    throw error;
  }
};

module.exports = invariant;
}).call(this,require('_process'))

},{"_process":19}],49:[function(require,module,exports){
/*!
 * Copyright (c) 2015 Chris O'Hara <cohara87@gmail.com>
 *
 * Permission is hereby granted, free of charge, to any person obtaining
 * a copy of this software and associated documentation files (the
 * "Software"), to deal in the Software without restriction, including
 * without limitation the rights to use, copy, modify, merge, publish,
 * distribute, sublicense, and/or sell copies of the Software, and to
 * permit persons to whom the Software is furnished to do so, subject to
 * the following conditions:
 *
 * The above copyright notice and this permission notice shall be
 * included in all copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND,
 * EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF
 * MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND
 * NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE
 * LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION
 * OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION
 * WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.
 */

(function (name, definition) {
    if (typeof exports !== 'undefined' && typeof module !== 'undefined') {
        module.exports = definition();
    } else if (typeof define === 'function' && typeof define.amd === 'object') {
        define(definition);
    } else {
        this[name] = definition();
    }
})('validator', function (validator) {

    'use strict';

    validator = { version: '4.1.0' };

    var emailUserPart = /^[a-z\d!#\$%&'\*\+\-\/=\?\^_`{\|}~]+$/i;
    var quotedEmailUser = /^([\s\x01-\x08\x0b\x0c\x0e-\x1f\x7f\x21\x23-\x5b\x5d-\x7e]|(\\[\x01-\x09\x0b\x0c\x0d-\x7f]))*$/i;

    var emailUserUtf8Part = /^[a-z\d!#\$%&'\*\+\-\/=\?\^_`{\|}~\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+$/i;
    var quotedEmailUserUtf8 = /^([\s\x01-\x08\x0b\x0c\x0e-\x1f\x7f\x21\x23-\x5b\x5d-\x7e\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]|(\\[\x01-\x09\x0b\x0c\x0d-\x7f\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]))*$/i;

    var displayName = /^[a-z\d!#\$%&'\*\+\-\/=\?\^_`{\|}~\.\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF]+[a-z\d!#\$%&'\*\+\-\/=\?\^_`{\|}~\.\u00A0-\uD7FF\uF900-\uFDCF\uFDF0-\uFFEF\s]*<(.+)>$/i;

    var creditCard = /^(?:4[0-9]{12}(?:[0-9]{3})?|5[1-5][0-9]{14}|6(?:011|5[0-9][0-9])[0-9]{12}|3[47][0-9]{13}|3(?:0[0-5]|[68][0-9])[0-9]{11}|(?:2131|1800|35\d{3})\d{11})$/;

    var isin = /^[A-Z]{2}[0-9A-Z]{9}[0-9]$/;

    var isbn10Maybe = /^(?:[0-9]{9}X|[0-9]{10})$/
      , isbn13Maybe = /^(?:[0-9]{13})$/;

    var ipv4Maybe = /^(\d+)\.(\d+)\.(\d+)\.(\d+)$/
      , ipv6Block = /^[0-9A-F]{1,4}$/i;

    var uuid = {
        '3': /^[0-9A-F]{8}-[0-9A-F]{4}-3[0-9A-F]{3}-[0-9A-F]{4}-[0-9A-F]{12}$/i
      , '4': /^[0-9A-F]{8}-[0-9A-F]{4}-4[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i
      , '5': /^[0-9A-F]{8}-[0-9A-F]{4}-5[0-9A-F]{3}-[89AB][0-9A-F]{3}-[0-9A-F]{12}$/i
      , all: /^[0-9A-F]{8}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{4}-[0-9A-F]{12}$/i
    };

    var alpha = /^[A-Z]+$/i
      , alphanumeric = /^[0-9A-Z]+$/i
      , numeric = /^[-+]?[0-9]+$/
      , int = /^(?:[-+]?(?:0|[1-9][0-9]*))$/
      , float = /^(?:[-+]?(?:[0-9]+))?(?:\.[0-9]*)?(?:[eE][\+\-]?(?:[0-9]+))?$/
      , hexadecimal = /^[0-9A-F]+$/i
      , decimal = /^[-+]?([0-9]+|\.[0-9]+|[0-9]+\.[0-9]+)$/
      , hexcolor = /^#?([0-9A-F]{3}|[0-9A-F]{6})$/i;

    var ascii = /^[\x00-\x7F]+$/
      , multibyte = /[^\x00-\x7F]/
      , fullWidth = /[^\u0020-\u007E\uFF61-\uFF9F\uFFA0-\uFFDC\uFFE8-\uFFEE0-9a-zA-Z]/
      , halfWidth = /[\u0020-\u007E\uFF61-\uFF9F\uFFA0-\uFFDC\uFFE8-\uFFEE0-9a-zA-Z]/;

    var surrogatePair = /[\uD800-\uDBFF][\uDC00-\uDFFF]/;

    var base64 = /^(?:[A-Z0-9+\/]{4})*(?:[A-Z0-9+\/]{2}==|[A-Z0-9+\/]{3}=|[A-Z0-9+\/]{4})$/i;

    var phones = {
      'zh-CN': /^(\+?0?86\-?)?1[345789]\d{9}$/,
      'zh-TW': /^(\+?886\-?|0)?9\d{8}$/,
      'en-ZA': /^(\+?27|0)\d{9}$/,
      'en-AU': /^(\+?61|0)4\d{8}$/,
      'en-HK': /^(\+?852\-?)?[569]\d{3}\-?\d{4}$/,
      'fr-FR': /^(\+?33|0)[67]\d{8}$/,
      'pt-PT': /^(\+351)?9[1236]\d{7}$/,
      'el-GR': /^(\+30)?((2\d{9})|(69\d{8}))$/,
      'en-GB': /^(\+?44|0)7\d{9}$/,
      'en-US': /^(\+?1)?[2-9]\d{2}[2-9](?!11)\d{6}$/,
      'en-ZM': /^(\+26)?09[567]\d{7}$/,
      'ru-RU': /^(\+?7|8)?9\d{9}$/
    };

    // from http://goo.gl/0ejHHW
    var iso8601 = /^([\+-]?\d{4}(?!\d{2}\b))((-?)((0[1-9]|1[0-2])(\3([12]\d|0[1-9]|3[01]))?|W([0-4]\d|5[0-2])(-?[1-7])?|(00[1-9]|0[1-9]\d|[12]\d{2}|3([0-5]\d|6[1-6])))([T\s]((([01]\d|2[0-3])((:?)[0-5]\d)?|24\:?00)([\.,]\d+(?!:))?)?(\17[0-5]\d([\.,]\d+)?)?([zZ]|([\+-])([01]\d|2[0-3]):?([0-5]\d)?)?)?)?$/;

    validator.extend = function (name, fn) {
        validator[name] = function () {
            var args = Array.prototype.slice.call(arguments);
            args[0] = validator.toString(args[0]);
            return fn.apply(validator, args);
        };
    };

    //Right before exporting the validator object, pass each of the builtins
    //through extend() so that their first argument is coerced to a string
    validator.init = function () {
        for (var name in validator) {
            if (typeof validator[name] !== 'function' || name === 'toString' ||
                    name === 'toDate' || name === 'extend' || name === 'init') {
                continue;
            }
            validator.extend(name, validator[name]);
        }
    };

    validator.toString = function (input) {
        if (typeof input === 'object' && input !== null && input.toString) {
            input = input.toString();
        } else if (input === null || typeof input === 'undefined' || (isNaN(input) && !input.length)) {
            input = '';
        } else if (typeof input !== 'string') {
            input += '';
        }
        return input;
    };

    validator.toDate = function (date) {
        if (Object.prototype.toString.call(date) === '[object Date]') {
            return date;
        }
        date = Date.parse(date);
        return !isNaN(date) ? new Date(date) : null;
    };

    validator.toFloat = function (str) {
        return parseFloat(str);
    };

    validator.toInt = function (str, radix) {
        return parseInt(str, radix || 10);
    };

    validator.toBoolean = function (str, strict) {
        if (strict) {
            return str === '1' || str === 'true';
        }
        return str !== '0' && str !== 'false' && str !== '';
    };

    validator.equals = function (str, comparison) {
        return str === validator.toString(comparison);
    };

    validator.contains = function (str, elem) {
        return str.indexOf(validator.toString(elem)) >= 0;
    };

    validator.matches = function (str, pattern, modifiers) {
        if (Object.prototype.toString.call(pattern) !== '[object RegExp]') {
            pattern = new RegExp(pattern, modifiers);
        }
        return pattern.test(str);
    };

    var default_email_options = {
        allow_display_name: false,
        allow_utf8_local_part: true,
        require_tld: true
    };

    validator.isEmail = function (str, options) {
        options = merge(options, default_email_options);

        if (options.allow_display_name) {
            var display_email = str.match(displayName);
            if (display_email) {
                str = display_email[1];
            }
        }

        var parts = str.split('@')
          , domain = parts.pop()
          , user = parts.join('@');

        var lower_domain = domain.toLowerCase();
        if (lower_domain === 'gmail.com' || lower_domain === 'googlemail.com') {
            user = user.replace(/\./g, '').toLowerCase();
        }

        if (!validator.isByteLength(user, 0, 64) ||
                !validator.isByteLength(domain, 0, 256)) {
            return false;
        }

        if (!validator.isFQDN(domain, {require_tld: options.require_tld})) {
            return false;
        }

        if (user[0] === '"') {
            user = user.slice(1, user.length - 1);
            return options.allow_utf8_local_part ?
                quotedEmailUserUtf8.test(user) :
                quotedEmailUser.test(user);
        }

        var pattern = options.allow_utf8_local_part ?
            emailUserUtf8Part : emailUserPart;

        var user_parts = user.split('.');
        for (var i = 0; i < user_parts.length; i++) {
            if (!pattern.test(user_parts[i])) {
                return false;
            }
        }

        return true;
    };

    var default_url_options = {
        protocols: [ 'http', 'https', 'ftp' ]
      , require_tld: true
      , require_protocol: false
      , require_valid_protocol: true
      , allow_underscores: false
      , allow_trailing_dot: false
      , allow_protocol_relative_urls: false
    };

    validator.isURL = function (url, options) {
        if (!url || url.length >= 2083 || /\s/.test(url)) {
            return false;
        }
        if (url.indexOf('mailto:') === 0) {
            return false;
        }
        options = merge(options, default_url_options);
        var protocol, auth, host, hostname, port,
            port_str, split;
        split = url.split('://');
        if (split.length > 1) {
            protocol = split.shift();
            if (options.require_valid_protocol && options.protocols.indexOf(protocol) === -1) {
                return false;
            }
        } else if (options.require_protocol) {
            return false;
        }  else if (options.allow_protocol_relative_urls && url.substr(0, 2) === '//') {
            split[0] = url.substr(2);
        }
        url = split.join('://');
        split = url.split('#');
        url = split.shift();

        split = url.split('?');
        url = split.shift();

        split = url.split('/');
        url = split.shift();
        split = url.split('@');
        if (split.length > 1) {
            auth = split.shift();
            if (auth.indexOf(':') >= 0 && auth.split(':').length > 2) {
                return false;
            }
        }
        hostname = split.join('@');
        split = hostname.split(':');
        host = split.shift();
        if (split.length) {
            port_str = split.join(':');
            port = parseInt(port_str, 10);
            if (!/^[0-9]+$/.test(port_str) || port <= 0 || port > 65535) {
                return false;
            }
        }
        if (!validator.isIP(host) && !validator.isFQDN(host, options) &&
                host !== 'localhost') {
            return false;
        }
        if (options.host_whitelist &&
                options.host_whitelist.indexOf(host) === -1) {
            return false;
        }
        if (options.host_blacklist &&
                options.host_blacklist.indexOf(host) !== -1) {
            return false;
        }
        return true;
    };

    validator.isIP = function (str, version) {
        version = validator.toString(version);
        if (!version) {
            return validator.isIP(str, 4) || validator.isIP(str, 6);
        } else if (version === '4') {
            if (!ipv4Maybe.test(str)) {
                return false;
            }
            var parts = str.split('.').sort(function (a, b) {
                return a - b;
            });
            return parts[3] <= 255;
        } else if (version === '6') {
            var blocks = str.split(':');
            var foundOmissionBlock = false; // marker to indicate ::

            // At least some OS accept the last 32 bits of an IPv6 address
            // (i.e. 2 of the blocks) in IPv4 notation, and RFC 3493 says
            // that '::ffff:a.b.c.d' is valid for IPv4-mapped IPv6 addresses,
            // and '::a.b.c.d' is deprecated, but also valid.
            var foundIPv4TransitionBlock = validator.isIP(blocks[blocks.length - 1], 4);
            var expectedNumberOfBlocks = foundIPv4TransitionBlock ? 7 : 8;

            if (blocks.length > expectedNumberOfBlocks)
                return false;

            // initial or final ::
            if (str === '::') {
                return true;
            } else if (str.substr(0, 2) === '::') {
                blocks.shift();
                blocks.shift();
                foundOmissionBlock = true;
            } else if (str.substr(str.length - 2) === '::') {
                blocks.pop();
                blocks.pop();
                foundOmissionBlock = true;
            }

            for (var i = 0; i < blocks.length; ++i) {
                // test for a :: which can not be at the string start/end
                // since those cases have been handled above
                if (blocks[i] === '' && i > 0 && i < blocks.length -1) {
                    if (foundOmissionBlock)
                        return false; // multiple :: in address
                    foundOmissionBlock = true;
                } else if (foundIPv4TransitionBlock && i == blocks.length - 1) {
                    // it has been checked before that the last
                    // block is a valid IPv4 address
                } else if (!ipv6Block.test(blocks[i])) {
                    return false;
                }
            }

            if (foundOmissionBlock) {
                return blocks.length >= 1;
            } else {
                return blocks.length === expectedNumberOfBlocks;
            }
        }
        return false;
    };

    var default_fqdn_options = {
        require_tld: true
      , allow_underscores: false
      , allow_trailing_dot: false
    };

    validator.isFQDN = function (str, options) {
        options = merge(options, default_fqdn_options);

        /* Remove the optional trailing dot before checking validity */
        if (options.allow_trailing_dot && str[str.length - 1] === '.') {
            str = str.substring(0, str.length - 1);
        }
        var parts = str.split('.');
        if (options.require_tld) {
            var tld = parts.pop();
            if (!parts.length || !/^([a-z\u00a1-\uffff]{2,}|xn[a-z0-9-]{2,})$/i.test(tld)) {
                return false;
            }
        }
        for (var part, i = 0; i < parts.length; i++) {
            part = parts[i];
            if (options.allow_underscores) {
                if (part.indexOf('__') >= 0) {
                    return false;
                }
                part = part.replace(/_/g, '');
            }
            if (!/^[a-z\u00a1-\uffff0-9-]+$/i.test(part)) {
                return false;
            }
            if (/[\uff01-\uff5e]/.test(part)) {
                // disallow full-width chars
                return false;
            }
            if (part[0] === '-' || part[part.length - 1] === '-' ||
                    part.indexOf('---') >= 0) {
                return false;
            }
        }
        return true;
    };

    validator.isBoolean = function(str) {
        return (['true', 'false', '1', '0'].indexOf(str) >= 0);
    };

    validator.isAlpha = function (str) {
        return alpha.test(str);
    };

    validator.isAlphanumeric = function (str) {
        return alphanumeric.test(str);
    };

    validator.isNumeric = function (str) {
        return numeric.test(str);
    };

    validator.isDecimal = function (str) {
        return str !== '' && decimal.test(str);
    };

    validator.isHexadecimal = function (str) {
        return hexadecimal.test(str);
    };

    validator.isHexColor = function (str) {
        return hexcolor.test(str);
    };

    validator.isLowercase = function (str) {
        return str === str.toLowerCase();
    };

    validator.isUppercase = function (str) {
        return str === str.toUpperCase();
    };

    validator.isInt = function (str, options) {
        options = options || {};
        return int.test(str) && (!options.hasOwnProperty('min') || str >= options.min) && (!options.hasOwnProperty('max') || str <= options.max);
    };

    validator.isFloat = function (str, options) {
        options = options || {};
        return str !== '' && float.test(str) && (!options.hasOwnProperty('min') || str >= options.min) && (!options.hasOwnProperty('max') || str <= options.max);
    };

    validator.isDivisibleBy = function (str, num) {
        return validator.toFloat(str) % validator.toInt(num) === 0;
    };

    validator.isNull = function (str) {
        return str.length === 0;
    };

    validator.isLength = function (str, min, max) {
        var surrogatePairs = str.match(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g) || [];
        var len = str.length - surrogatePairs.length;
        return len >= min && (typeof max === 'undefined' || len <= max);
    };

    validator.isByteLength = function (str, min, max) {
        var len = encodeURI(str).split(/%..|./).length - 1;
        return len >= min && (typeof max === 'undefined' || len <= max);
    };

    validator.isUUID = function (str, version) {
        var pattern = uuid[version ? version : 'all'];
        return pattern && pattern.test(str);
    };

    validator.isDate = function (str) {
        var normalizedDate = new Date((new Date(str)).toUTCString());
        var regularDay = String(normalizedDate.getDate());
        var utcDay = String(normalizedDate.getUTCDate());
        var dayOrYear, dayOrYearMatches, year;
        if (isNaN(Date.parse(normalizedDate))) {
            return false;
        }
        //check for valid double digits that could be late days
        //check for all matches since a string like '12/23' is a valid date
        //ignore everything with nearby colons
        dayOrYearMatches = str.match(/(^|[^:\d])[23]\d([^:\d]|$)/g);
        if (!dayOrYearMatches) {
            return true;
        }
        dayOrYear = dayOrYearMatches.map(function(digitString) {
            return digitString.match(/\d+/g)[0];
        }).join('/');
        year = String(normalizedDate.getFullYear()).slice(-2);
        //local date and UTC date can differ, but both are valid, so check agains both
        if (dayOrYear === regularDay || dayOrYear === utcDay || dayOrYear === year) {
            return true;
        } else if ((dayOrYear === (regularDay + '/' + year)) || (dayOrYear === (year + '/' + regularDay))) {
            return true;
        } else if ((dayOrYear === (utcDay + '/' + year)) || (dayOrYear === (year + '/' + utcDay))) {
            return true;
        } else {
            return false;
        }
    };

    validator.isAfter = function (str, date) {
        var comparison = validator.toDate(date || new Date())
          , original = validator.toDate(str);
        return !!(original && comparison && original > comparison);
    };

    validator.isBefore = function (str, date) {
        var comparison = validator.toDate(date || new Date())
          , original = validator.toDate(str);
        return !!(original && comparison && original < comparison);
    };

    validator.isIn = function (str, options) {
        var i;
        if (Object.prototype.toString.call(options) === '[object Array]') {
            var array = [];
            for (i in options) {
                array[i] = validator.toString(options[i]);
            }
            return array.indexOf(str) >= 0;
        } else if (typeof options === 'object') {
            return options.hasOwnProperty(str);
        } else if (options && typeof options.indexOf === 'function') {
            return options.indexOf(str) >= 0;
        }
        return false;
    };

    validator.isCreditCard = function (str) {
        var sanitized = str.replace(/[^0-9]+/g, '');
        if (!creditCard.test(sanitized)) {
            return false;
        }
        var sum = 0, digit, tmpNum, shouldDouble;
        for (var i = sanitized.length - 1; i >= 0; i--) {
            digit = sanitized.substring(i, (i + 1));
            tmpNum = parseInt(digit, 10);
            if (shouldDouble) {
                tmpNum *= 2;
                if (tmpNum >= 10) {
                    sum += ((tmpNum % 10) + 1);
                } else {
                    sum += tmpNum;
                }
            } else {
                sum += tmpNum;
            }
            shouldDouble = !shouldDouble;
        }
        return !!((sum % 10) === 0 ? sanitized : false);
    };

    validator.isISIN = function (str) {
        if (!isin.test(str)) {
            return false;
        }

        var checksumStr = str.replace(/[A-Z]/g, function(character) {
            return parseInt(character, 36);
        });

        var sum = 0, digit, tmpNum, shouldDouble = true;
        for (var i = checksumStr.length - 2; i >= 0; i--) {
            digit = checksumStr.substring(i, (i + 1));
            tmpNum = parseInt(digit, 10);
            if (shouldDouble) {
                tmpNum *= 2;
                if (tmpNum >= 10) {
                    sum += tmpNum + 1;
                } else {
                    sum += tmpNum;
                }
            } else {
                sum += tmpNum;
            }
            shouldDouble = !shouldDouble;
        }

        return parseInt(str.substr(str.length - 1), 10) === (10000 - sum) % 10;
    };

    validator.isISBN = function (str, version) {
        version = validator.toString(version);
        if (!version) {
            return validator.isISBN(str, 10) || validator.isISBN(str, 13);
        }
        var sanitized = str.replace(/[\s-]+/g, '')
          , checksum = 0, i;
        if (version === '10') {
            if (!isbn10Maybe.test(sanitized)) {
                return false;
            }
            for (i = 0; i < 9; i++) {
                checksum += (i + 1) * sanitized.charAt(i);
            }
            if (sanitized.charAt(9) === 'X') {
                checksum += 10 * 10;
            } else {
                checksum += 10 * sanitized.charAt(9);
            }
            if ((checksum % 11) === 0) {
                return !!sanitized;
            }
        } else  if (version === '13') {
            if (!isbn13Maybe.test(sanitized)) {
                return false;
            }
            var factor = [ 1, 3 ];
            for (i = 0; i < 12; i++) {
                checksum += factor[i % 2] * sanitized.charAt(i);
            }
            if (sanitized.charAt(12) - ((10 - (checksum % 10)) % 10) === 0) {
                return !!sanitized;
            }
        }
        return false;
    };

    validator.isMobilePhone = function(str, locale) {
        if (locale in phones) {
            return phones[locale].test(str);
        }
        return false;
    };

    var default_currency_options = {
        symbol: '$'
      , require_symbol: false
      , allow_space_after_symbol: false
      , symbol_after_digits: false
      , allow_negatives: true
      , parens_for_negatives: false
      , negative_sign_before_digits: false
      , negative_sign_after_digits: false
      , allow_negative_sign_placeholder: false
      , thousands_separator: ','
      , decimal_separator: '.'
      , allow_space_after_digits: false
    };

    validator.isCurrency = function (str, options) {
        options = merge(options, default_currency_options);

        return currencyRegex(options).test(str);
    };

    validator.isJSON = function (str) {
        try {
            var obj = JSON.parse(str);
            return !!obj && typeof obj === 'object';
        } catch (e) {}
        return false;
    };

    validator.isMultibyte = function (str) {
        return multibyte.test(str);
    };

    validator.isAscii = function (str) {
        return ascii.test(str);
    };

    validator.isFullWidth = function (str) {
        return fullWidth.test(str);
    };

    validator.isHalfWidth = function (str) {
        return halfWidth.test(str);
    };

    validator.isVariableWidth = function (str) {
        return fullWidth.test(str) && halfWidth.test(str);
    };

    validator.isSurrogatePair = function (str) {
        return surrogatePair.test(str);
    };

    validator.isBase64 = function (str) {
        return base64.test(str);
    };

    validator.isMongoId = function (str) {
        return validator.isHexadecimal(str) && str.length === 24;
    };

    validator.isISO8601 = function (str) {
        return iso8601.test(str);
    };

    validator.ltrim = function (str, chars) {
        var pattern = chars ? new RegExp('^[' + chars + ']+', 'g') : /^\s+/g;
        return str.replace(pattern, '');
    };

    validator.rtrim = function (str, chars) {
        var pattern = chars ? new RegExp('[' + chars + ']+$', 'g') : /\s+$/g;
        return str.replace(pattern, '');
    };

    validator.trim = function (str, chars) {
        var pattern = chars ? new RegExp('^[' + chars + ']+|[' + chars + ']+$', 'g') : /^\s+|\s+$/g;
        return str.replace(pattern, '');
    };

    validator.escape = function (str) {
        return (str.replace(/&/g, '&amp;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#x27;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/\//g, '&#x2F;')
            .replace(/\`/g, '&#96;'));
    };

    validator.stripLow = function (str, keep_new_lines) {
        var chars = keep_new_lines ? '\\x00-\\x09\\x0B\\x0C\\x0E-\\x1F\\x7F' : '\\x00-\\x1F\\x7F';
        return validator.blacklist(str, chars);
    };

    validator.whitelist = function (str, chars) {
        return str.replace(new RegExp('[^' + chars + ']+', 'g'), '');
    };

    validator.blacklist = function (str, chars) {
        return str.replace(new RegExp('[' + chars + ']+', 'g'), '');
    };

    var default_normalize_email_options = {
        lowercase: true
    };

    validator.normalizeEmail = function (email, options) {
        options = merge(options, default_normalize_email_options);
        if (!validator.isEmail(email)) {
            return false;
        }
        var parts = email.split('@', 2);
        parts[1] = parts[1].toLowerCase();
        if (parts[1] === 'gmail.com' || parts[1] === 'googlemail.com') {
            parts[0] = parts[0].toLowerCase().replace(/\./g, '');
            if (parts[0][0] === '+') {
                return false;
            }
            parts[0] = parts[0].split('+')[0];
            parts[1] = 'gmail.com';
        } else if (options.lowercase) {
            parts[0] = parts[0].toLowerCase();
        }
        return parts.join('@');
    };

    function merge(obj, defaults) {
        obj = obj || {};
        for (var key in defaults) {
            if (typeof obj[key] === 'undefined') {
                obj[key] = defaults[key];
            }
        }
        return obj;
    }

    function currencyRegex(options) {
        var symbol = '(\\' + options.symbol.replace(/\./g, '\\.') + ')' + (options.require_symbol ? '' : '?')
            , negative = '-?'
            , whole_dollar_amount_without_sep = '[1-9]\\d*'
            , whole_dollar_amount_with_sep = '[1-9]\\d{0,2}(\\' + options.thousands_separator + '\\d{3})*'
            , valid_whole_dollar_amounts = ['0', whole_dollar_amount_without_sep, whole_dollar_amount_with_sep]
            , whole_dollar_amount = '(' + valid_whole_dollar_amounts.join('|') + ')?'
            , decimal_amount = '(\\' + options.decimal_separator + '\\d{2})?';
        var pattern = whole_dollar_amount + decimal_amount;
        // default is negative sign before symbol, but there are two other options (besides parens)
        if (options.allow_negatives && !options.parens_for_negatives) {
            if (options.negative_sign_after_digits) {
                pattern += negative;
            }
            else if (options.negative_sign_before_digits) {
                pattern = negative + pattern;
            }
        }
        // South African Rand, for example, uses R 123 (space) and R-123 (no space)
        if (options.allow_negative_sign_placeholder) {
            pattern = '( (?!\\-))?' + pattern;
        }
        else if (options.allow_space_after_symbol) {
            pattern = ' ?' + pattern;
        }
        else if (options.allow_space_after_digits) {
            pattern += '( (?!$))?';
        }
        if (options.symbol_after_digits) {
            pattern += symbol;
        } else {
            pattern = symbol + pattern;
        }
        if (options.allow_negatives) {
            if (options.parens_for_negatives) {
                pattern = '(\\(' + pattern + '\\)|' + pattern + ')';
            }
            else if (!(options.negative_sign_before_digits || options.negative_sign_after_digits)) {
                pattern = negative + pattern;
            }
        }
        return new RegExp(
            '^' +
            // ensure there's a dollar and/or decimal amount, and that it doesn't start with a space or a negative sign followed by a space
            '(?!-? )(?=.*\\d)' +
            pattern +
            '$'
        );
    }

    validator.init();

    return validator;

});

},{}],50:[function(require,module,exports){
/**
 * Module dependencies.
 */

var slice = require('sliced')
var flatten = require('array-flatten')

/**
 * This function lets us create virtual nodes using a simple
 * syntax. It is compatible with JSX transforms so you can use
 * JSX to write nodes that will compile to this function.
 *
 * let node = element('div', { id: 'foo' }, [
 *   element('a', { href: 'http://google.com' }, 'Google')
 * ])
 *
 * You can leave out the attributes or the children if either
 * of them aren't needed and it will figure out what you're
 * trying to do.
 */

module.exports = element

/**
 * Create virtual trees of components.
 *
 * This creates the nicer API for the user.
 * It translates that friendly API into an actual tree of nodes.
 *
 * @param {*} type
 * @param {Object} attributes
 * @param {Array} children
 * @return {Object}
 * @api public
 */

function element (type, attributes, children) {
  // Default to div with no args
  if (!type) {
    throw new TypeError('element() needs a type.')
  }

  // Skipped adding attributes and we're passing
  // in children instead.
  if (arguments.length === 2 && (typeof attributes === 'string' || Array.isArray(attributes))) {
    children = [ attributes ]
    attributes = {}
  }

  // Account for JSX putting the children as multiple arguments.
  // This is essentially just the ES6 rest param
  if (arguments.length > 2) {
    children = slice(arguments, 2)
  }

  children = children || []
  attributes = attributes || {}

  // Flatten nested child arrays. This is how JSX compiles some nodes.
  children = flatten(children, 2)

  // Filter out any `undefined` elements
  children = children.filter(function (i) { return typeof i !== 'undefined' })

  // if you pass in a function, it's a `Component` constructor.
  // otherwise it's an element.
  return {
    type: type,
    children: children,
    attributes: attributes
  }
}

},{"array-flatten":51,"sliced":52}],51:[function(require,module,exports){
'use strict'

/**
 * Expose `arrayFlatten`.
 */
module.exports = arrayFlatten

/**
 * Recursive flatten function with depth.
 *
 * @param  {Array}  array
 * @param  {Array}  result
 * @param  {Number} depth
 * @return {Array}
 */
function flattenWithDepth (array, result, depth) {
  for (var i = 0; i < array.length; i++) {
    var value = array[i]

    if (depth > 0 && Array.isArray(value)) {
      flattenWithDepth(value, result, depth - 1)
    } else {
      result.push(value)
    }
  }

  return result
}

/**
 * Recursive flatten function. Omitting depth is slightly faster.
 *
 * @param  {Array} array
 * @param  {Array} result
 * @return {Array}
 */
function flattenForever (array, result) {
  for (var i = 0; i < array.length; i++) {
    var value = array[i]

    if (Array.isArray(value)) {
      flattenForever(value, result)
    } else {
      result.push(value)
    }
  }

  return result
}

/**
 * Flatten an array, with the ability to define a depth.
 *
 * @param  {Array}  array
 * @param  {Number} depth
 * @return {Array}
 */
function arrayFlatten (array, depth) {
  if (depth == null) {
    return flattenForever(array, [])
  }

  return flattenWithDepth(array, [], depth)
}

},{}],52:[function(require,module,exports){
module.exports = exports = require('./lib/sliced');

},{"./lib/sliced":53}],53:[function(require,module,exports){

/**
 * An Array.prototype.slice.call(arguments) alternative
 *
 * @param {Object} args something with a length
 * @param {Number} slice
 * @param {Number} sliceEnd
 * @api public
 */

module.exports = function (args, slice, sliceEnd) {
  var ret = [];
  var len = args.length;

  if (0 === len) return ret;

  var start = slice < 0
    ? Math.max(0, slice + len)
    : slice || 0;

  if (sliceEnd !== undefined) {
    len = sliceEnd < 0
      ? sliceEnd + len
      : sliceEnd
  }

  while (len-- > start) {
    ret[len - start] = args[len];
  }

  return ret;
}


},{}],54:[function(require,module,exports){
'use strict';

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _coreConstants = require('./core/constants');

var _coreDispatcher = require('./core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var _coreApplication = require('./core/application');

var _coreApplication2 = _interopRequireDefault(_coreApplication);

_coreApplication2['default'].start();

},{"./core/application":63,"./core/constants":64,"./core/dispatcher":65}],55:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _virtualElement = require('virtual-element');

var _virtualElement2 = _interopRequireDefault(_virtualElement);

var _deku = require('deku');

exports['default'] = {
  render: function render() {
    return (0, _virtualElement2['default'])('div', { 'class': 'ui pointing inverted menu' });
  }
};
module.exports = exports['default'];

},{"deku":22,"virtual-element":50}],56:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
    value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _virtualElement = require('virtual-element');

var _virtualElement2 = _interopRequireDefault(_virtualElement);

var _deku = require('deku');

exports['default'] = {
    render: function render() {
        return (0, _virtualElement2['default'])(
            'div',
            { 'class': 'ui pointing inverted menu' },
            (0, _virtualElement2['default'])(
                'a',
                { 'class': 'active item' },
                (0, _virtualElement2['default'])('i', { 'class': 'inverted blue home icon' }),
                ' Documents'
            ),
            (0, _virtualElement2['default'])(
                'div',
                { 'class': 'right menu' },
                (0, _virtualElement2['default'])(
                    'a',
                    { 'class': 'item' },
                    (0, _virtualElement2['default'])('i', { 'class': 'inverted blue settings icon' }),
                    ' Settings'
                ),
                (0, _virtualElement2['default'])(
                    'a',
                    { 'class': 'item' },
                    (0, _virtualElement2['default'])('i', { 'class': 'inverted blue user icon' }),
                    ' Login'
                )
            )
        );
    }
};
module.exports = exports['default'];

},{"deku":22,"virtual-element":50}],57:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _virtualElement = require('virtual-element');

var _virtualElement2 = _interopRequireDefault(_virtualElement);

var _documentEditor = require('./document-editor');

var _documentEditor2 = _interopRequireDefault(_documentEditor);

var _documentList = require('./document-list');

var _documentList2 = _interopRequireDefault(_documentList);

exports['default'] = {
  render: function render() {
    return (0, _virtualElement2['default'])(
      'section',
      { 'class': 'view ui grid container' },
      (0, _virtualElement2['default'])(
        'div',
        { 'class': 'four wide column' },
        (0, _virtualElement2['default'])(_documentList2['default'], { title: 'documents' })
      ),
      (0, _virtualElement2['default'])(
        'div',
        { 'class': 'twelve wide column' },
        (0, _virtualElement2['default'])(_documentEditor2['default'], null)
      )
    );
  }
};
module.exports = exports['default'];

},{"./document-editor":58,"./document-list":59,"virtual-element":50}],58:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _virtualElement = require('virtual-element');

var _virtualElement2 = _interopRequireDefault(_virtualElement);

var _coreConstants = require('../core/constants');

var _coreDispatcher = require('../core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var _storesDocument = require('../stores/document');

var _storesDocument2 = _interopRequireDefault(_storesDocument);

var DocumentEditor = {
  initialState: function initialState(props) {
    return {
      loaded: false,
      body: "I have document powers!"
    };
  },

  afterMount: function afterMount(c, el, setState) {
    var editor;
    return regeneratorRuntime.async(function afterMount$(context$1$0) {
      while (1) switch (context$1$0.prev = context$1$0.next) {
        case 0:
          editor = new EpicEditor({
            basePath: 'epiceditor',
            autogrow: true
          });

          editor.load();
          editor.on("update", function () {
            // DocumentStore.save()
          });
          _coreDispatcher2['default'].register(function (action) {
            if (action.actionType == _coreConstants.ACTIONS.SELECT_DOCUMENT) {
              editor.getElement('editor').body.innerHTML = _storesDocument2['default'].getState()[action.id].body;
            }
          });

          setState({ loaded: true });

        case 5:
        case 'end':
          return context$1$0.stop();
      }
    }, null, this);
  },

  render: function render(_ref, setState) {
    var props = _ref.props;
    var state = _ref.state;

    return (0, _virtualElement2['default'])('div', { id: 'epiceditor' });
  }
};
exports['default'] = DocumentEditor;
module.exports = exports['default'];

// document selected listener

},{"../core/constants":64,"../core/dispatcher":65,"../stores/document":70,"virtual-element":50}],59:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _virtualElement = require('virtual-element');

var _virtualElement2 = _interopRequireDefault(_virtualElement);

var _coreConstants = require('../core/constants');

var _coreDispatcher = require('../core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var _storesDocument = require('../stores/document');

var _storesDocument2 = _interopRequireDefault(_storesDocument);

var Loader = {
  render: function render(_ref) {
    var props = _ref.props;

    return (0, _virtualElement2['default'])(
      'div',
      { 'class': 'ui ' + (props.active ? "active" : "") + ' dimmer' },
      (0, _virtualElement2['default'])(
        'div',
        { 'class': 'ui text loader' },
        'Loading'
      )
    );
  }
};

var DocumentItem = {
  render: function render(c) {
    var _item = c.props.item;
    var select = function select() {
      return _coreDispatcher2['default'].dispatch({
        actionType: _coreConstants.ACTIONS.SELECT_DOCUMENT,
        id: _item.id
      });
    };
    var Wrap = {
      render: function render(_ref2) {
        var props = _ref2.props;

        if (c.props.active) return (0, _virtualElement2['default'])(
          'div',
          { 'class': 'active item' },
          props.children
        );
        return (0, _virtualElement2['default'])(
          'a',
          { 'class': 'item', onClick: select },
          props.children
        );
      }
    };

    return (0, _virtualElement2['default'])(
      Wrap,
      null,
      _item.name
    );
  }
};

var initialState = function initialState(props) {
  return {
    loading: true,
    selected: null,
    items: _storesDocument2['default'].getState(),
    adding: false
  };
};

function updateItems(setState) {
  return function () {
    return setState({
      loading: false,
      items: _storesDocument2['default'].getState()
    });
  };
}

var afterMount = function afterMount(c, el, setState) {
  // document sync listener
  var onSync = updateItems(setState);
  _storesDocument2['default'].on('sync:success', onSync);
  setState({ onSync: onSync });

  // document selected listener
  _coreDispatcher2['default'].register(function (action) {
    if (action.actionType == _coreConstants.ACTIONS.SELECT_DOCUMENT) {
      setState({
        selected: action.id
      });
    }
  });
};

var beforeUnmount = function beforeUnmount(c) {
  _storesDocument2['default'].removeListener('sync:success', c.state.onSync);
};

var render = function render(_ref3, setState) {
  var props = _ref3.props;
  var state = _ref3.state;
  var _state$items = state.items;
  var items = _state$items === undefined ? [] : _state$items;

  var add = function add() {
    _coreDispatcher2['default'].dispatch({
      actionType: _coreConstants.ACTIONS.CREATE_DOCUMENT
    });
  };

  var list = items.map(function (item) {
    return (0, _virtualElement2['default'])(DocumentItem, { active: item.id === state.selected, item: item, onClick: 'false' });
  });

  return (0, _virtualElement2['default'])(
    'div',
    { 'class': 'ui link list' },
    (0, _virtualElement2['default'])(
      Loader,
      { active: state.loading },
      'Loading'
    ),
    state.adding ? (0, _virtualElement2['default'])(
      'div',
      null,
      (0, _virtualElement2['default'])('input', { type: 'text', 'class': 'ui tiny basic input', onChange: function (e) {
          return setState({ adding: e.target.value });
        } }),
      (0, _virtualElement2['default'])(
        'div',
        { 'class': 'ui tiny basic button', onClick: add },
        (0, _virtualElement2['default'])('i', { 'class': 'icon add' })
      )
    ) : (0, _virtualElement2['default'])(
      'div',
      { 'class': 'ui basic button', onClick: function () {
          return setState({ adding: '' });
        } },
      'New'
    ),
    list
  );
};
var DocumentList = {
  initialState: initialState,
  afterMount: afterMount,
  beforeUnmount: beforeUnmount,
  render: render
};
exports['default'] = DocumentList;
module.exports = exports['default'];

},{"../core/constants":64,"../core/dispatcher":65,"../stores/document":70,"virtual-element":50}],60:[function(require,module,exports){
"use strict";

Object.defineProperty(exports, "__esModule", {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { "default": obj }; }

var _virtualElement = require('virtual-element');

var _virtualElement2 = _interopRequireDefault(_virtualElement);

var ghstyle = "\n  position: absolute;\n  top: 0px;\n  left: 0px;\n";
var ghforksrc = "https://camo.githubusercontent.com/c6286ade715e9bea433b4705870de482a654f78a/68747470733a2f2f73332e616d617a6f6e6177732e636f6d2f6769746875622f726962626f6e732f666f726b6d655f6c6566745f77686974655f6666666666662e706e67";
var canonicalwtf = "https://s3.amazonaws.com/github/ribbons/forkme_left_white_ffffff.png";

var Forkme = {
  render: function render(_ref) {
    var props = _ref.props;
    return (0, _virtualElement2["default"])(
      "a",
      { href: "https://github.com/" + props.repo, style: ghstyle },
      (0, _virtualElement2["default"])("img", { src: ghforksrc, alt: "Fork me on GitHub", "data-canonical-src": canonicalwtf })
    );
  }
};
exports["default"] = Forkme;
module.exports = exports["default"];

},{"virtual-element":50}],61:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _deku = require('deku');

var _virtualElement = require('virtual-element');

var _virtualElement2 = _interopRequireDefault(_virtualElement);

var _forkme = require('./forkme');

var _forkme2 = _interopRequireDefault(_forkme);

var _appHeader = require('./app-header');

var _appHeader2 = _interopRequireDefault(_appHeader);

var _appView = require('./app-view');

var _appView2 = _interopRequireDefault(_appView);

var _appFooter = require('./app-footer');

var _appFooter2 = _interopRequireDefault(_appFooter);

var _coreConstants = require('../core/constants');

var _coreDispatcher = require('../core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var Layout = {
  initialState: function initialState() {
    return {
      view: _appView2['default']
    };
  },
  afterMount: function afterMount(c, el, update) {
    var onNavigate = function onNavigate(data) {
      data.actionType != _coreConstants.ACTIONS.NAVIGATE || update({ 'view': data.view });
    };

    _coreDispatcher2['default'].register(onNavigate);
  },
  render: function render(c) {
    var View = c.state.view;
    return (0, _virtualElement2['default'])(
      'main',
      { 'class': 'ui layout container' },
      (0, _virtualElement2['default'])(_forkme2['default'], { repo: 'ds0nt/mdpad' }),
      (0, _virtualElement2['default'])(_appHeader2['default'], null),
      (0, _virtualElement2['default'])(View, null),
      (0, _virtualElement2['default'])(_appFooter2['default'], null)
    );
  }
};

var init = function init() {
  (0, _deku.render)((0, _deku.tree)((0, _virtualElement2['default'])(Layout, null)), document.getElementById('app'));
};

exports['default'] = {
  Layout: Layout,
  init: init
};
module.exports = exports['default'];

},{"../core/constants":64,"../core/dispatcher":65,"./app-footer":55,"./app-header":56,"./app-view":57,"./forkme":60,"deku":22,"virtual-element":50}],62:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _virtualElement = require('virtual-element');

var _virtualElement2 = _interopRequireDefault(_virtualElement);

var _storesAuth = require('../stores/auth');

var _storesAuth2 = _interopRequireDefault(_storesAuth);

var _coreDispatcher = require('../core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var _coreConstants = require('../core/constants');

function createFieldHandler(name) {
  return function (e, c, setState) {
    var update = {};
    update[name] = e.target.value;
    setState(update);
  };
}

function handleSubmit(e, component, setState) {
  e.preventDefault();
  setState({ submitting: true });
  _coreDispatcher2['default'].dispatch({
    actionType: _coreConstants.ACTIONS.LOGIN,
    username: component.state.username,
    password: component.state.password
  });
}

var initialState = function initialState() {
  return {
    username: '',
    password: '',
    submitting: false,
    error: ''
  };
};
var afterMount = function afterMount(c, el, setState) {
  var fn = function fn(error) {
    return setState({
      submitting: false,
      error: error
    });
  };
  _storesAuth2['default'].on('login:failure', fn);
  setState({ loginHandler: fn });
};

var beforeUnmount = function beforeUnmount(c) {
  _storesAuth2['default'].removeListener('login:failure', c.state.loginHandler);
};

var render = function render(c) {
  var state = c.state;
  var props = c.props;

  var buttonContent = 'Login';
  if (state.submitting) {
    buttonContent = (0, _virtualElement2['default'])('img', { src: '/img/loading.gif', alt: 'Logging in...' });
  }

  return (0, _virtualElement2['default'])(
    'div',
    { 'class': 'login-page' },
    (0, _virtualElement2['default'])(
      'form',
      { onSubmit: handleSubmit, 'class': 'pure-form' },
      (0, _virtualElement2['default'])(
        'p',
        { 'class': 'error' },
        state.error
      ),
      (0, _virtualElement2['default'])('input', { type: 'text', onChange: createFieldHandler('username'), value: state.username, placeholder: 'Username' }),
      (0, _virtualElement2['default'])('input', { type: 'password', onChange: createFieldHandler('password'), value: state.password, placeholder: 'Password' }),
      (0, _virtualElement2['default'])(
        'button',
        { type: 'submit' },
        buttonContent
      )
    ),
    (0, _virtualElement2['default'])(
      'p',
      { 'class': 'login-signup-link' },
      (0, _virtualElement2['default'])(
        'a',
        { href: '/signup' },
        'Need an account?'
      )
    )
  );
};
var LoginView = {
  initialState: initialState,
  afterMount: afterMount,
  beforeUnmount: beforeUnmount,
  render: render
};
exports['default'] = LoginView;
module.exports = exports['default'];

},{"../core/constants":64,"../core/dispatcher":65,"../stores/auth":69,"virtual-element":50}],63:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

var _director = require('director');

var _storesAuth = require('../stores/auth');

var _storesAuth2 = _interopRequireDefault(_storesAuth);

var _componentsLayout = require('../components/layout');

var _componentsLayout2 = _interopRequireDefault(_componentsLayout);

var _coreConstants = require('../core/constants');

var _componentsAppView = require('../components/app-view');

var _componentsAppView2 = _interopRequireDefault(_componentsAppView);

var _componentsLoginView = require('../components/login-view');

var _componentsLoginView2 = _interopRequireDefault(_componentsLoginView);

var _coreDispatcher = require('../core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var Application = (function () {
  function Application() {
    var _this = this;

    _classCallCheck(this, Application);

    _componentsLayout2['default'].init();
    this.router = (0, _director.Router)({
      '/': [this.authed, this.app],
      '/login': [this.unauthed, this.login],
      '/signup': [this.unauthed, this.signup],
      '/logout': [this.authed, this.logout]
    });
    this.router.init();
    _storesAuth2['default'].on('login:success', function () {
      return _this.router.setRoute('/');
    });
  }

  _createClass(Application, [{
    key: 'start',
    value: function start() {}
  }, {
    key: 'authed',
    value: function authed() {
      if (!_storesAuth2['default'].isAuthenticated()) {
        this.setRoute('/login');
      }
    }
  }, {
    key: 'unauthed',
    value: function unauthed() {
      if (_storesAuth2['default'].isAuthenticated()) {
        this.setRoute('/');
      }
    }
  }, {
    key: 'app',
    value: function app() {
      _coreDispatcher2['default'].dispatch({
        actionType: _coreConstants.ACTIONS.SYNC_DOCUMENTS
      });
      _coreDispatcher2['default'].dispatch({
        actionType: _coreConstants.ACTIONS.NAVIGATE,
        view: _componentsAppView2['default']
      });
    }
  }, {
    key: 'login',
    value: function login() {
      _coreDispatcher2['default'].dispatch({
        actionType: _coreConstants.ACTIONS.NAVIGATE,
        view: _componentsLoginView2['default']
      });
    }
  }, {
    key: 'logout',
    value: function logout() {
      _coreDispatcher2['default'].dispatch({
        actionType: _coreConstants.ACTIONS.LOGOUT
      });
    }
  }, {
    key: 'signup',
    value: function signup() {
      _coreDispatcher2['default'].dispatch({
        actionType: _coreConstants.ACTIONS.NAVIGATE,
        view: 'signup'
      });
    }
  }]);

  return Application;
})();

exports['default'] = new Application();
module.exports = exports['default'];

},{"../components/app-view":57,"../components/layout":61,"../components/login-view":62,"../core/constants":64,"../core/dispatcher":65,"../stores/auth":69,"director":45}],64:[function(require,module,exports){
'use strict';

module.exports = {
  API_URL: 'http://localhost:3000',
  AUTH_HEADER: 'X-JWT-TOKEN',
  AUTH_DATA_KEY: 'authData',
  ACTIONS: {
    NAVIGATE: 'navigate',
    LOGIN: 'login',
    LOGOUT: 'logout',
    SIGNUP: 'signup',
    SYNC_DOCUMENTS: 'sync_documents',
    CREATE_DOCUMENT: 'create_document',
    SELECT_DOCUMENT: 'select_document',
    ARCHIVE_DOCUMENT: 'archive_document'
  }
};

},{}],65:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _flux = require('flux');

var _flux2 = _interopRequireDefault(_flux);

exports['default'] = new _flux2['default'].Dispatcher();
module.exports = exports['default'];

},{"flux":46}],66:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _get = function get(_x, _x2, _x3) { var _again = true; _function: while (_again) { var object = _x, property = _x2, receiver = _x3; desc = parent = getter = undefined; _again = false; if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { _x = parent; _x2 = property; _x3 = receiver; _again = true; continue _function; } } else if ('value' in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } } };

exports.errorFromXHR = errorFromXHR;

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

function _inherits(subClass, superClass) { if (typeof superClass !== 'function' && superClass !== null) { throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var NetworkError = (function (_Error) {
  _inherits(NetworkError, _Error);

  function NetworkError(statusCode, message) {
    _classCallCheck(this, NetworkError);

    _get(Object.getPrototypeOf(NetworkError.prototype), 'constructor', this).call(this);
    this.name = 'NetworkError';
    this.message = message || 'Unknown HTTP Error';
    this.statusCode = statusCode || 500;
    this.stack = new Error().stack;
  }

  return NetworkError;
})(Error);

exports.NetworkError = NetworkError;

var BadRequestError = (function (_NetworkError) {
  _inherits(BadRequestError, _NetworkError);

  function BadRequestError(details) {
    _classCallCheck(this, BadRequestError);

    _get(Object.getPrototypeOf(BadRequestError.prototype), 'constructor', this).call(this, 400, 'Bad Request');
    this.name = 'BadRequestError';
    this.details = details;
  }

  return BadRequestError;
})(NetworkError);

exports.BadRequestError = BadRequestError;

var UnauthorizedError = (function (_NetworkError2) {
  _inherits(UnauthorizedError, _NetworkError2);

  function UnauthorizedError() {
    _classCallCheck(this, UnauthorizedError);

    _get(Object.getPrototypeOf(UnauthorizedError.prototype), 'constructor', this).call(this, 401, 'Unauthorized');
    this.name = 'UnauthorizedError';
  }

  return UnauthorizedError;
})(NetworkError);

exports.UnauthorizedError = UnauthorizedError;

var ForbiddenError = (function (_NetworkError3) {
  _inherits(ForbiddenError, _NetworkError3);

  function ForbiddenError() {
    _classCallCheck(this, ForbiddenError);

    _get(Object.getPrototypeOf(ForbiddenError.prototype), 'constructor', this).call(this, 403, 'Forbidden');
    this.name = 'ForbiddenError';
  }

  return ForbiddenError;
})(NetworkError);

exports.ForbiddenError = ForbiddenError;

var NotFoundError = (function (_NetworkError4) {
  _inherits(NotFoundError, _NetworkError4);

  function NotFoundError() {
    _classCallCheck(this, NotFoundError);

    _get(Object.getPrototypeOf(NotFoundError.prototype), 'constructor', this).call(this, 404, 'Not Found');
    this.name = 'NotFoundError';
  }

  return NotFoundError;
})(NetworkError);

exports.NotFoundError = NotFoundError;

var MethodNotAllowedError = (function (_NetworkError5) {
  _inherits(MethodNotAllowedError, _NetworkError5);

  function MethodNotAllowedError() {
    _classCallCheck(this, MethodNotAllowedError);

    _get(Object.getPrototypeOf(MethodNotAllowedError.prototype), 'constructor', this).call(this, 405, 'Method Not Allowed');
    this.name = 'MethodNotAllowedError';
  }

  return MethodNotAllowedError;
})(NetworkError);

exports.MethodNotAllowedError = MethodNotAllowedError;

function errorFromXHR(xhr) {
  if (xhr.status) {
    switch (xhr.status) {
      case 400:
        return new BadRequestError();
        break;

      case 401:
        return new UnauthorizedError();
        break;

      case 403:
        return new ForbiddenError();
        break;

      case 404:
        return new NotFoundError();
        break;

      case 405:
        return new MethodNotAllowedError();
        break;

      default:
        return new NetworkError(xhr.status, xhr.statusText);
        break;
    }
  } else {
    // Not an XHR
    return xhr;
  }
}

},{}],67:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _axios = require('axios');

var _axios2 = _interopRequireDefault(_axios);

var _coreConstants = require('../core/constants');

exports['default'] = {
  login: function login(data) {
    return _axios2['default'].get(_coreConstants.API_URL + '/auth/login', data);
  }
};
module.exports = exports['default'];

},{"../core/constants":64,"axios":1}],68:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _axios = require('axios');

var _axios2 = _interopRequireDefault(_axios);

var _coreConstants = require('../core/constants');

var _validator = require('validator');

var _validator2 = _interopRequireDefault(_validator);

function validate(data) {}

var endpoint = _coreConstants.API_URL + '/documents';
exports['default'] = {
  sync: function sync() {
    return _axios2['default'].get(endpoint);
  },
  fetch: function fetch(id) {
    return _axios2['default'].get(endpoint + ('/' + id));
  },
  create: function create(data) {
    return _axios2['default'].post(endpoint, data);
  },
  update: function update(id, data) {
    return _axios2['default'].put(endpoint + ('/' + id), data);
  },
  'delete': function _delete(id) {
    return _axios2['default']['delete'](endpoint + ('/' + id));
  }
};
module.exports = exports['default'];

},{"../core/constants":64,"axios":1,"validator":49}],69:[function(require,module,exports){
/**
 * AuthStore
 * a store that uses api calls and local storage to manage token based user authentication
 *
 * dispatches:
 *
 * handles:
 *   ACTIONS.LOGIN
 *   ACTIONS.LOGOUT
 *
 * emits:
 *   - login:success, login:failure, login:activate
 *   - logout:success
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

var _get = function get(_x, _x2, _x3) { var _again = true; _function: while (_again) { var object = _x, property = _x2, receiver = _x3; desc = parent = getter = undefined; _again = false; if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { _x = parent; _x2 = property; _x3 = receiver; _again = true; continue _function; } } else if ('value' in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } } };

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

function _inherits(subClass, superClass) { if (typeof superClass !== 'function' && superClass !== null) { throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var _coreConstants = require('../core/constants');

var _coreDispatcher = require('../core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var _coreErrors = require('../core/errors');

var _coreErrors2 = _interopRequireDefault(_coreErrors);

var _restAuth = require('../rest/auth');

var _restAuth2 = _interopRequireDefault(_restAuth);

var _events = require('events');

var AuthStore = (function (_EventEmitter) {
  _inherits(AuthStore, _EventEmitter);

  function AuthStore() {
    var _this = this;

    _classCallCheck(this, AuthStore);

    _get(Object.getPrototypeOf(AuthStore.prototype), 'constructor', this).call(this);
    this._authToken = null;
    this._authenticatedUser = null;
    var data = this.getAuthData();
    if (data && data.token && data.user) this.authenticate(data);

    _coreDispatcher2['default'].register(function (action) {
      switch (action.actionType) {
        case _coreConstants.ACTIONS.LOGIN:
          return _this.loginAction(action);
        case _coreConstants.ACTIONS.LOGOUT:
          return _this.logoutAction(action);
      }
    });
  }

  // Save authentication data in local storage

  _createClass(AuthStore, [{
    key: 'getAuthData',
    value: function getAuthData() {
      return JSON.parse(sessionStorage.getItem(_coreConstants.AUTH_DATA_KEY));
    }
  }, {
    key: 'setAuthData',
    value: function setAuthData(data) {
      sessionStorage.setItem(_coreConstants.AUTH_DATA_KEY, JSON.stringify(data));
    }
  }, {
    key: 'clearAuthData',
    value: function clearAuthData() {
      sessionStorage.removeItem(_coreConstants.AUTH_DATA_KEY);
    }
  }, {
    key: 'isAuthenticated',
    value: function isAuthenticated() {
      return typeof this._authToken === 'string';
    }
  }, {
    key: 'authenticate',
    value: function authenticate(data) {
      this.setAuthData(data);
      this._authToken = data.token;
      this._authenticatedUser = data.user;
    }
  }, {
    key: 'loginAction',
    value: function loginAction(action) {
      var _ref, data;

      return regeneratorRuntime.async(function loginAction$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            context$2$0.prev = 0;
            context$2$0.next = 3;
            return regeneratorRuntime.awrap(_restAuth2['default'].login({
              username: action.username,
              password: action.password
            }));

          case 3:
            _ref = context$2$0.sent;
            data = _ref.data;

            this.authenticate(data);
            this.emit('login:success', data);
            context$2$0.next = 12;
            break;

          case 9:
            context$2$0.prev = 9;
            context$2$0.t0 = context$2$0['catch'](0);

            if (context$2$0.t0 instanceof _coreErrors2['default'].UnauthorizedError) {
              this.emit('login:failure', "Incorrect username or password");
            } else if (context$2$0.t0 instanceof _coreErrors2['default'].ForbiddenError) {
              this.emit('login:activate');
            } else if (context$2$0.t0 instanceof _coreErrors2['default'].NotFoundError) {
              this.emit('login:failure', "Incorrect username or password");
            } else {
              console.error(context$2$0.t0.stack);
            }

          case 12:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this, [[0, 9]]);
    }
  }, {
    key: 'logoutAction',
    value: function logoutAction(action) {
      return regeneratorRuntime.async(function logoutAction$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            console.log('logoutAction', action);
            this.clearAuthData();
            this._authToken = null;
            this._authenticatedUser = null;
            this.emit('logout:success');

          case 5:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this);
    }
  }]);

  return AuthStore;
})(_events.EventEmitter);

exports['default'] = new AuthStore();
module.exports = exports['default'];

},{"../core/constants":64,"../core/dispatcher":65,"../core/errors":66,"../rest/auth":67,"events":18}],70:[function(require,module,exports){
/**
 * AuthStore
 * a store that uses api calls and local storage to manage token based user authentication
 *
 * dispatches:
 *
 * handles:
 *   ACTIONS.SYNC_DOCUMENTS
 *
 * emits:
 *   - sync:success, sync:failure
 */

'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

var _get = function get(_x, _x2, _x3) { var _again = true; _function: while (_again) { var object = _x, property = _x2, receiver = _x3; desc = parent = getter = undefined; _again = false; if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { _x = parent; _x2 = property; _x3 = receiver; _again = true; continue _function; } } else if ('value' in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } } };

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

function _inherits(subClass, superClass) { if (typeof superClass !== 'function' && superClass !== null) { throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var _coreConstants = require('../core/constants');

var _coreDispatcher = require('../core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var _restDocuments = require('../rest/documents');

var _restDocuments2 = _interopRequireDefault(_restDocuments);

var _events = require('events');

var DocumentStore = (function (_EventEmitter) {
  _inherits(DocumentStore, _EventEmitter);

  function DocumentStore() {
    var _this = this;

    _classCallCheck(this, DocumentStore);

    _get(Object.getPrototypeOf(DocumentStore.prototype), 'constructor', this).call(this);
    this.state = [];
    _coreDispatcher2['default'].register(function (action) {
      switch (action.actionType) {
        case _coreConstants.ACTIONS.SYNC_DOCUMENTS:
          return _this.sync(action);
      }
    });
  }

  _createClass(DocumentStore, [{
    key: 'sync',
    value: function sync() {
      var _ref, data;

      return regeneratorRuntime.async(function sync$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            console.log('syncing documents');
            context$2$0.prev = 1;
            context$2$0.next = 4;
            return regeneratorRuntime.awrap(_restDocuments2['default'].sync());

          case 4:
            _ref = context$2$0.sent;
            data = _ref.data;

            this.state = data;
            console.log('sync:success', data);
            this.emit('sync:success');
            context$2$0.next = 14;
            break;

          case 11:
            context$2$0.prev = 11;
            context$2$0.t0 = context$2$0['catch'](1);

            this.emit('sync:failure');

          case 14:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this, [[1, 11]]);
    }
  }, {
    key: 'getState',
    value: function getState() {
      return this.state;
    }
  }]);

  return DocumentStore;
})(_events.EventEmitter);

exports['default'] = new DocumentStore();
module.exports = exports['default'];

},{"../core/constants":64,"../core/dispatcher":65,"../rest/documents":68,"events":18}]},{},[54])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9icm93c2VyLXBhY2svX3ByZWx1ZGUuanMiLCJub2RlX21vZHVsZXMvYXhpb3MvaW5kZXguanMiLCJub2RlX21vZHVsZXMvYXhpb3MvbGliL2FkYXB0ZXJzL3hoci5qcyIsIm5vZGVfbW9kdWxlcy9heGlvcy9saWIvYXhpb3MuanMiLCJub2RlX21vZHVsZXMvYXhpb3MvbGliL2NvcmUvSW50ZXJjZXB0b3JNYW5hZ2VyLmpzIiwibm9kZV9tb2R1bGVzL2F4aW9zL2xpYi9jb3JlL2Rpc3BhdGNoUmVxdWVzdC5qcyIsIm5vZGVfbW9kdWxlcy9heGlvcy9saWIvZGVmYXVsdHMuanMiLCJub2RlX21vZHVsZXMvYXhpb3MvbGliL2hlbHBlcnMvYnVpbGRVcmwuanMiLCJub2RlX21vZHVsZXMvYXhpb3MvbGliL2hlbHBlcnMvY29va2llcy5qcyIsIm5vZGVfbW9kdWxlcy9heGlvcy9saWIvaGVscGVycy9wYXJzZUhlYWRlcnMuanMiLCJub2RlX21vZHVsZXMvYXhpb3MvbGliL2hlbHBlcnMvc3ByZWFkLmpzIiwibm9kZV9tb2R1bGVzL2F4aW9zL2xpYi9oZWxwZXJzL3RyYW5zZm9ybURhdGEuanMiLCJub2RlX21vZHVsZXMvYXhpb3MvbGliL2hlbHBlcnMvdXJsSXNTYW1lT3JpZ2luLmpzIiwibm9kZV9tb2R1bGVzL2F4aW9zL2xpYi91dGlscy5qcyIsIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9iYXNlNjQtanMvbGliL2I2NC5qcyIsIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2llZWU3NTQvaW5kZXguanMiLCJub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pcy1hcnJheS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9ldmVudHMvZXZlbnRzLmpzIiwibm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3Byb2Nlc3MvYnJvd3Nlci5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L2xpYi9hcHBsaWNhdGlvbi5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L2xpYi9ldmVudHMuanMiLCJub2RlX21vZHVsZXMvZGVrdS9saWIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZGVrdS9saWIvbm9kZS10eXBlLmpzIiwibm9kZV9tb2R1bGVzL2Rla3UvbGliL3JlbmRlci5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L2xpYi9zdHJpbmdpZnkuanMiLCJub2RlX21vZHVsZXMvZGVrdS9saWIvc3ZnLmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2NvbXBvbmVudC1lbWl0dGVyL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2NvbXBvbmVudC1yYWYvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZGVrdS9ub2RlX21vZHVsZXMvY29tcG9uZW50LXR5cGUvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZGVrdS9ub2RlX21vZHVsZXMvZmFzdC5qcy9hcnJheS9mb3JFYWNoLmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2Zhc3QuanMvYXJyYXkvcmVkdWNlLmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2Zhc3QuanMvZm9yRWFjaC5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L25vZGVfbW9kdWxlcy9mYXN0LmpzL2Z1bmN0aW9uL2JpbmRJbnRlcm5hbDMuanMiLCJub2RlX21vZHVsZXMvZGVrdS9ub2RlX21vZHVsZXMvZmFzdC5qcy9mdW5jdGlvbi9iaW5kSW50ZXJuYWw0LmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2Zhc3QuanMvb2JqZWN0L2Fzc2lnbi5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L25vZGVfbW9kdWxlcy9mYXN0LmpzL29iamVjdC9mb3JFYWNoLmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2Zhc3QuanMvb2JqZWN0L3JlZHVjZS5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L25vZGVfbW9kdWxlcy9mYXN0LmpzL3JlZHVjZS5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L25vZGVfbW9kdWxlcy9nZXQtdWlkL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2lzLWRvbS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L25vZGVfbW9kdWxlcy9pcy1zdmctYXR0cmlidXRlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2lzLXN2Zy1lbGVtZW50L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL29iamVjdC1kZWZhdWx0cy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L25vZGVfbW9kdWxlcy9vYmplY3QtcGF0aC9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9kaXJlY3Rvci9idWlsZC9kaXJlY3Rvci5qcyIsIm5vZGVfbW9kdWxlcy9mbHV4L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2ZsdXgvbGliL0Rpc3BhdGNoZXIuanMiLCJub2RlX21vZHVsZXMvZmx1eC9ub2RlX21vZHVsZXMvZmJqcy9saWIvaW52YXJpYW50LmpzIiwibm9kZV9tb2R1bGVzL3ZhbGlkYXRvci92YWxpZGF0b3IuanMiLCJub2RlX21vZHVsZXMvdmlydHVhbC1lbGVtZW50L2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3ZpcnR1YWwtZWxlbWVudC9ub2RlX21vZHVsZXMvYXJyYXktZmxhdHRlbi9hcnJheS1mbGF0dGVuLmpzIiwibm9kZV9tb2R1bGVzL3ZpcnR1YWwtZWxlbWVudC9ub2RlX21vZHVsZXMvc2xpY2VkL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL3ZpcnR1YWwtZWxlbWVudC9ub2RlX21vZHVsZXMvc2xpY2VkL2xpYi9zbGljZWQuanMiLCIvaG9tZS9kc29udC9nby9zcmMvZ2l0aHViLmNvbS9kczBudC9tYXJrZG93bi9hcHAvc3JjL2FwcC5qcyIsIi9ob21lL2Rzb250L2dvL3NyYy9naXRodWIuY29tL2RzMG50L21hcmtkb3duL2FwcC9zcmMvY29tcG9uZW50cy9hcHAtZm9vdGVyLmpzIiwiL2hvbWUvZHNvbnQvZ28vc3JjL2dpdGh1Yi5jb20vZHMwbnQvbWFya2Rvd24vYXBwL3NyYy9jb21wb25lbnRzL2FwcC1oZWFkZXIuanMiLCIvaG9tZS9kc29udC9nby9zcmMvZ2l0aHViLmNvbS9kczBudC9tYXJrZG93bi9hcHAvc3JjL2NvbXBvbmVudHMvYXBwLXZpZXcuanMiLCIvaG9tZS9kc29udC9nby9zcmMvZ2l0aHViLmNvbS9kczBudC9tYXJrZG93bi9hcHAvc3JjL2NvbXBvbmVudHMvZG9jdW1lbnQtZWRpdG9yLmpzIiwiL2hvbWUvZHNvbnQvZ28vc3JjL2dpdGh1Yi5jb20vZHMwbnQvbWFya2Rvd24vYXBwL3NyYy9jb21wb25lbnRzL2RvY3VtZW50LWxpc3QuanMiLCIvaG9tZS9kc29udC9nby9zcmMvZ2l0aHViLmNvbS9kczBudC9tYXJrZG93bi9hcHAvc3JjL2NvbXBvbmVudHMvZm9ya21lLmpzIiwiL2hvbWUvZHNvbnQvZ28vc3JjL2dpdGh1Yi5jb20vZHMwbnQvbWFya2Rvd24vYXBwL3NyYy9jb21wb25lbnRzL2xheW91dC5qcyIsIi9ob21lL2Rzb250L2dvL3NyYy9naXRodWIuY29tL2RzMG50L21hcmtkb3duL2FwcC9zcmMvY29tcG9uZW50cy9sb2dpbi12aWV3LmpzIiwiL2hvbWUvZHNvbnQvZ28vc3JjL2dpdGh1Yi5jb20vZHMwbnQvbWFya2Rvd24vYXBwL3NyYy9jb3JlL2FwcGxpY2F0aW9uLmpzIiwiL2hvbWUvZHNvbnQvZ28vc3JjL2dpdGh1Yi5jb20vZHMwbnQvbWFya2Rvd24vYXBwL3NyYy9jb3JlL2NvbnN0YW50cy5qcyIsIi9ob21lL2Rzb250L2dvL3NyYy9naXRodWIuY29tL2RzMG50L21hcmtkb3duL2FwcC9zcmMvY29yZS9kaXNwYXRjaGVyLmpzIiwiL2hvbWUvZHNvbnQvZ28vc3JjL2dpdGh1Yi5jb20vZHMwbnQvbWFya2Rvd24vYXBwL3NyYy9jb3JlL2Vycm9ycy5qcyIsIi9ob21lL2Rzb250L2dvL3NyYy9naXRodWIuY29tL2RzMG50L21hcmtkb3duL2FwcC9zcmMvcmVzdC9hdXRoLmpzIiwiL2hvbWUvZHNvbnQvZ28vc3JjL2dpdGh1Yi5jb20vZHMwbnQvbWFya2Rvd24vYXBwL3NyYy9yZXN0L2RvY3VtZW50cy5qcyIsIi9ob21lL2Rzb250L2dvL3NyYy9naXRodWIuY29tL2RzMG50L21hcmtkb3duL2FwcC9zcmMvc3RvcmVzL2F1dGguanMiLCIvaG9tZS9kc29udC9nby9zcmMvZ2l0aHViLmNvbS9kczBudC9tYXJrZG93bi9hcHAvc3JjL3N0b3Jlcy9kb2N1bWVudC5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDcERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzFCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUN6UEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUN0Z0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUhBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUM3U0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDaEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMXhDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ0xBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNqS0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDbENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDcENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ1hBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN2QkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNyQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDZkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzNEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdFJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDcHRCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNWQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7O0FDdE9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDaERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDanpCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4RUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoRUE7QUFDQTs7QUNEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7OzZCQ2pDd0Isa0JBQWtCOzs4QkFDbkIsbUJBQW1COzs7OytCQUNsQixvQkFBb0I7Ozs7QUFFNUMsNkJBQVksS0FBSyxFQUFFLENBQUE7Ozs7Ozs7Ozs7OzhCQ0pDLGlCQUFpQjs7OztvQkFDUixNQUFNOztxQkFFcEI7QUFDYixRQUFNLEVBQUU7V0FDTiwwQ0FBSyxTQUFNLDJCQUEyQixHQUNoQztHQUFBO0NBQ1Q7Ozs7Ozs7Ozs7Ozs4QkNQbUIsaUJBQWlCOzs7O29CQUNSLE1BQU07O3FCQUVwQjtBQUNiLFVBQU0sRUFBRTtlQUNQOztjQUFLLFNBQU0sMkJBQTJCO1lBQ25DOztrQkFBRyxTQUFNLGFBQWE7Z0JBQ2xCLHdDQUFHLFNBQU0seUJBQXlCLEdBQUs7O2FBQ3ZDO1lBQ0o7O2tCQUFLLFNBQU0sWUFBWTtnQkFDbkI7O3NCQUFHLFNBQU0sTUFBTTtvQkFDWCx3Q0FBRyxTQUFNLDZCQUE2QixHQUFLOztpQkFDM0M7Z0JBQ0o7O3NCQUFHLFNBQU0sTUFBTTtvQkFDWCx3Q0FBRyxTQUFNLHlCQUF5QixHQUFLOztpQkFDdkM7YUFDRjtTQUNGO0tBQUE7Q0FDVDs7Ozs7Ozs7Ozs7OzhCQ2xCbUIsaUJBQWlCOzs7OzhCQUVWLG1CQUFtQjs7Ozs0QkFDckIsaUJBQWlCOzs7O3FCQUUzQjtBQUNiLFFBQU0sRUFBRTtXQUNOOztRQUFTLFNBQU0sd0JBQXdCO01BQ3JDOztVQUFLLFNBQU0sa0JBQWtCO1FBQzNCLDhEQUFjLEtBQUssRUFBQyxXQUFXLEdBQUc7T0FDOUI7TUFDTjs7VUFBSyxTQUFNLG9CQUFvQjtRQUM3QixtRUFBa0I7T0FDZDtLQUNFO0dBQUE7Q0FDYjs7Ozs7Ozs7Ozs7OzhCQ2ZtQixpQkFBaUI7Ozs7NkJBQ2YsbUJBQW1COzs4QkFDbEIsb0JBQW9COzs7OzhCQUNqQixvQkFBb0I7Ozs7QUFHOUMsSUFBSSxjQUFjLEdBQUc7QUFDbkIsY0FBWSxFQUFBLHNCQUFDLEtBQUssRUFBRTtBQUNsQixXQUFPO0FBQ0wsWUFBTSxFQUFFLEtBQUs7QUFDYixVQUFJLEVBQUUseUJBQXlCO0tBQ2hDLENBQUE7R0FDRjs7QUFFRCxBQUFNLFlBQVUsRUFBQSxvQkFBQyxDQUFDLEVBQUUsRUFBRSxFQUFFLFFBQVE7UUFHMUIsTUFBTTs7OztBQUFOLGdCQUFNLEdBQUcsSUFBSSxVQUFVLENBQUM7QUFDMUIsb0JBQVEsRUFBRSxZQUFZO0FBQ3RCLG9CQUFRLEVBQUUsSUFBSTtXQUNmLENBQUM7O0FBQ0YsZ0JBQU0sQ0FBQyxJQUFJLEVBQUUsQ0FBQTtBQUNiLGdCQUFNLENBQUMsRUFBRSxDQUFDLFFBQVEsRUFBRSxZQUFNOztXQUV6QixDQUFDLENBQUE7QUFDRixzQ0FBVyxRQUFRLENBQUMsVUFBQSxNQUFNLEVBQUk7QUFDNUIsZ0JBQUksTUFBTSxDQUFDLFVBQVUsSUFBSSx1QkFBUSxlQUFlLEVBQUU7QUFDaEQsb0JBQU0sQ0FBQyxVQUFVLENBQUMsUUFBUSxDQUFDLENBQUMsSUFBSSxDQUFDLFNBQVMsR0FBRyw0QkFBYyxRQUFRLEVBQUUsQ0FBQyxNQUFNLENBQUMsRUFBRSxDQUFDLENBQUMsSUFBSSxDQUFBO2FBQ3RGO1dBQ0YsQ0FBQyxDQUFBOztBQUVGLGtCQUFRLENBQUMsRUFBRSxNQUFNLEVBQUUsSUFBSSxFQUFFLENBQUMsQ0FBQTs7Ozs7OztHQUMzQjs7QUFFRCxRQUFNLEVBQUEsZ0JBQUMsSUFBZ0IsRUFBRSxRQUFRLEVBQUU7UUFBMUIsS0FBSyxHQUFQLElBQWdCLENBQWQsS0FBSztRQUFFLEtBQUssR0FBZCxJQUFnQixDQUFQLEtBQUs7O0FBQ25CLFdBQU8sMENBQUssRUFBRSxFQUFDLFlBQVksR0FBTyxDQUFBO0dBQ25DO0NBQ0YsQ0FBQTtxQkFDYyxjQUFjOzs7Ozs7Ozs7Ozs7Ozs4QkN0Q1QsaUJBQWlCOzs7OzZCQUVmLG1CQUFtQjs7OEJBQ2xCLG9CQUFvQjs7Ozs4QkFDakIsb0JBQW9COzs7O0FBRTlDLElBQUksTUFBTSxHQUFHO0FBQ1gsUUFBTSxFQUFBLGdCQUFDLElBQU8sRUFBRTtRQUFSLEtBQUssR0FBTixJQUFPLENBQU4sS0FBSzs7QUFDWCxXQUFPOztRQUFLLGtCQUFhLEtBQUssQ0FBQyxNQUFNLEdBQUcsUUFBUSxHQUFHLEVBQUUsQ0FBQSxZQUFVO01BQzdEOztVQUFLLFNBQU0sZ0JBQWdCOztPQUFjO0tBQ3JDLENBQUE7R0FDUDtDQUNGLENBQUE7O0FBRUQsSUFBSSxZQUFZLEdBQUc7QUFDakIsUUFBTSxFQUFFLGdCQUFBLENBQUMsRUFBSTtBQUNYLFFBQUksS0FBSyxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFBO0FBQ3hCLFFBQUksTUFBTSxHQUFHLFNBQVQsTUFBTTthQUFTLDRCQUFXLFFBQVEsQ0FBQztBQUNyQyxrQkFBVSxFQUFFLHVCQUFRLGVBQWU7QUFDbkMsVUFBRSxFQUFFLEtBQUssQ0FBQyxFQUFFO09BQ2IsQ0FBQztLQUFBLENBQUE7QUFDRixRQUFJLElBQUksR0FBRztBQUNULFlBQU0sRUFBQyxnQkFBQyxLQUFPLEVBQUU7WUFBUixLQUFLLEdBQU4sS0FBTyxDQUFOLEtBQUs7O0FBQ1osWUFBSSxDQUFDLENBQUMsS0FBSyxDQUFDLE1BQU0sRUFDaEIsT0FBTzs7WUFBSyxTQUFNLGFBQWE7VUFBRSxLQUFLLENBQUMsUUFBUTtTQUFPLENBQUE7QUFDeEQsZUFBTzs7WUFBRyxTQUFNLE1BQU0sRUFBQyxPQUFPLEVBQUUsTUFBTSxBQUFDO1VBQUUsS0FBSyxDQUFDLFFBQVE7U0FBSyxDQUFBO09BQzdEO0tBQ0YsQ0FBQTs7QUFFRCxXQUFPO0FBQUMsVUFBSTs7TUFBRSxLQUFLLENBQUMsSUFBSTtLQUFRLENBQUE7R0FDakM7Q0FDRixDQUFBOztBQUVELElBQUksWUFBWSxHQUFHLFNBQWYsWUFBWSxDQUFJLEtBQUs7U0FBTTtBQUM3QixXQUFPLEVBQUUsSUFBSTtBQUNiLFlBQVEsRUFBRSxJQUFJO0FBQ2QsU0FBSyxFQUFFLDRCQUFjLFFBQVEsRUFBRTtBQUMvQixVQUFNLEVBQUUsS0FBSztHQUNkO0NBQUMsQ0FBQTs7QUFFRixTQUFTLFdBQVcsQ0FBQyxRQUFRLEVBQUU7QUFDN0IsU0FBTztXQUFNLFFBQVEsQ0FBQztBQUNwQixhQUFPLEVBQUUsS0FBSztBQUNkLFdBQUssRUFBRSw0QkFBYyxRQUFRLEVBQUU7S0FDaEMsQ0FBQztHQUFBLENBQUE7Q0FDSDs7QUFFRCxJQUFJLFVBQVUsR0FBRyxTQUFiLFVBQVUsQ0FBSSxDQUFDLEVBQUUsRUFBRSxFQUFFLFFBQVEsRUFBSzs7QUFFcEMsTUFBSSxNQUFNLEdBQUcsV0FBVyxDQUFDLFFBQVEsQ0FBQyxDQUFBO0FBQ2xDLDhCQUFjLEVBQUUsQ0FBQyxjQUFjLEVBQUUsTUFBTSxDQUFDLENBQUE7QUFDeEMsVUFBUSxDQUFDLEVBQUUsTUFBTSxFQUFOLE1BQU0sRUFBRSxDQUFDLENBQUE7OztBQUdwQiw4QkFBVyxRQUFRLENBQUMsVUFBQSxNQUFNLEVBQUk7QUFDNUIsUUFBSSxNQUFNLENBQUMsVUFBVSxJQUFJLHVCQUFRLGVBQWUsRUFBRTtBQUNoRCxjQUFRLENBQUM7QUFDUCxnQkFBUSxFQUFFLE1BQU0sQ0FBQyxFQUFFO09BQ3BCLENBQUMsQ0FBQTtLQUNIO0dBQ0YsQ0FBQyxDQUFBO0NBQ0gsQ0FBQTs7QUFFRCxJQUFJLGFBQWEsR0FBRyxTQUFoQixhQUFhLENBQUksQ0FBQyxFQUFLO0FBQ3pCLDhCQUFjLGNBQWMsQ0FBQyxjQUFjLEVBQUUsQ0FBQyxDQUFDLEtBQUssQ0FBQyxNQUFNLENBQUMsQ0FBQTtDQUM3RCxDQUFBOztBQUVELElBQUksTUFBTSxHQUFHLFNBQVQsTUFBTSxDQUFJLEtBQWdCLEVBQUUsUUFBUSxFQUFLO01BQTdCLEtBQUssR0FBUCxLQUFnQixDQUFkLEtBQUs7TUFBRSxLQUFLLEdBQWQsS0FBZ0IsQ0FBUCxLQUFLO3FCQUNQLEtBQUssQ0FBbEIsS0FBSztNQUFMLEtBQUssZ0NBQUMsRUFBRTs7QUFFZCxNQUFJLEdBQUcsR0FBRyxTQUFOLEdBQUcsR0FBUztBQUNkLGdDQUFXLFFBQVEsQ0FBQztBQUNsQixnQkFBVSxFQUFHLHVCQUFRLGVBQWU7S0FDckMsQ0FBQyxDQUFDO0dBQ0osQ0FBQTs7QUFFRCxNQUFJLElBQUksR0FBRyxLQUFLLENBQUMsR0FBRyxDQUFDLFVBQUEsSUFBSTtXQUFJLGlDQUFDLFlBQVksSUFBQyxNQUFNLEVBQUUsSUFBSSxDQUFDLEVBQUUsS0FBSyxLQUFLLENBQUMsUUFBUSxBQUFDLEVBQUMsSUFBSSxFQUFFLElBQUksQUFBQyxFQUFDLE9BQU8sRUFBQyxPQUFPLEdBQUc7R0FBQSxDQUFDLENBQUE7O0FBRTlHLFNBQU87O01BQUssU0FBTSxjQUFjO0lBQzlCO0FBQUMsWUFBTTtRQUFDLE1BQU0sRUFBRSxLQUFLLENBQUMsT0FBTyxBQUFDOztLQUFpQjtJQUUzQyxLQUFLLENBQUMsTUFBTSxHQUVWOzs7TUFDRSw0Q0FBTyxJQUFJLEVBQUMsTUFBTSxFQUFDLFNBQU0scUJBQXFCLEVBQUMsUUFBUSxFQUFHLFVBQUEsQ0FBQztpQkFBSSxRQUFRLENBQUMsRUFBRSxNQUFNLEVBQUUsQ0FBQyxDQUFDLE1BQU0sQ0FBQyxLQUFLLEVBQUUsQ0FBQztTQUFBLEFBQUUsR0FBRztNQUN4Rzs7VUFBSyxTQUFNLHNCQUFzQixFQUFDLE9BQU8sRUFBRSxHQUFHLEFBQUM7UUFDN0Msd0NBQUcsU0FBTSxVQUFVLEdBQUs7T0FDcEI7S0FDRixHQUVOOztRQUFLLFNBQU0saUJBQWlCLEVBQUMsT0FBTyxFQUFFO2lCQUFNLFFBQVEsQ0FBQyxFQUFFLE1BQU0sRUFBRSxFQUFFLEVBQUUsQ0FBQztTQUFBLEFBQUM7O0tBRS9EO0lBRVgsSUFBSTtHQUVELENBQUE7Q0FDUCxDQUFBO0FBQ0QsSUFBSSxZQUFZLEdBQUc7QUFDakIsY0FBWSxFQUFaLFlBQVk7QUFDWixZQUFVLEVBQVYsVUFBVTtBQUNWLGVBQWEsRUFBYixhQUFhO0FBQ2IsUUFBTSxFQUFOLE1BQU07Q0FDUCxDQUFBO3FCQUNjLFlBQVk7Ozs7Ozs7Ozs7Ozs4QkN4R1AsaUJBQWlCOzs7O0FBRXJDLElBQUksT0FBTyx5REFJVixDQUFBO0FBQ0QsSUFBSSxTQUFTLEdBQUcsc05BQXNOLENBQUE7QUFDdE8sSUFBSSxZQUFZLEdBQUcsc0VBQXNFLENBQUE7O0FBRXpGLElBQUksTUFBTSxHQUFHO0FBQ1gsUUFBTSxFQUFFLGdCQUFDLElBQU87UUFBTixLQUFLLEdBQU4sSUFBTyxDQUFOLEtBQUs7V0FDYjs7UUFBRyxJQUFJLDBCQUF3QixLQUFLLENBQUMsSUFBSSxBQUFHLEVBQUMsS0FBSyxFQUFFLE9BQU8sQUFBQztNQUMxRCwwQ0FBSyxHQUFHLEVBQUUsU0FBUyxBQUFDLEVBQUMsR0FBRyxFQUFDLG1CQUFtQixFQUFDLHNCQUFvQixZQUFZLEFBQUMsR0FBRztLQUMvRTtHQUFBO0NBQ1AsQ0FBQTtxQkFDYyxNQUFNOzs7Ozs7Ozs7Ozs7b0JDaEJRLE1BQU07OzhCQUNmLGlCQUFpQjs7OztzQkFFbEIsVUFBVTs7Ozt5QkFDVixjQUFjOzs7O3VCQUNiLFlBQVk7Ozs7eUJBQ2IsY0FBYzs7Ozs2QkFFVCxtQkFBbUI7OzhCQUNwQixvQkFBb0I7Ozs7QUFFM0MsSUFBSSxNQUFNLEdBQUc7QUFDWCxjQUFZLEVBQUU7V0FBTztBQUNuQixVQUFJLHNCQUFTO0tBQ2Q7R0FBQztBQUNGLFlBQVUsRUFBRSxvQkFBQyxDQUFDLEVBQUUsRUFBRSxFQUFFLE1BQU0sRUFBSztBQUM3QixRQUFJLFVBQVUsR0FBRyxTQUFiLFVBQVUsQ0FBRyxJQUFJLEVBQUk7QUFDdkIsVUFBSSxDQUFDLFVBQVUsSUFBSSx1QkFBUSxRQUFRLElBQUksTUFBTSxDQUFDLEVBQUMsTUFBTSxFQUFFLElBQUksQ0FBQyxJQUFJLEVBQUMsQ0FBQyxDQUFBO0tBQ25FLENBQUE7O0FBRUQsZ0NBQVcsUUFBUSxDQUFFLFVBQVUsQ0FBRSxDQUFBO0dBQ2xDO0FBQ0QsUUFBTSxFQUFFLGdCQUFBLENBQUMsRUFBSTtBQUNYLFFBQUksSUFBSSxHQUFHLENBQUMsQ0FBQyxLQUFLLENBQUMsSUFBSSxDQUFBO0FBQ3ZCLFdBQU87O1FBQU0sU0FBTSxxQkFBcUI7TUFDdEMsd0RBQVEsSUFBSSxFQUFDLGFBQWEsR0FBRztNQUM3Qiw4REFBVTtNQUNWLGlDQUFDLElBQUksT0FBRztNQUNSLDhEQUFVO0tBQ0wsQ0FBQTtHQUNSO0NBQ0YsQ0FBQTs7QUFFRCxJQUFJLElBQUksR0FBRyxTQUFQLElBQUksR0FBUztBQUNmLG9CQUFPLGdCQUFLLGlDQUFDLE1BQU0sT0FBRyxDQUFDLEVBQUUsUUFBUSxDQUFDLGNBQWMsQ0FBQyxLQUFLLENBQUMsQ0FBQyxDQUFBO0NBQ3pELENBQUE7O3FCQUVjO0FBQ2IsUUFBTSxFQUFOLE1BQU07QUFDTixNQUFJLEVBQUosSUFBSTtDQUNMOzs7Ozs7Ozs7Ozs7OEJDeENtQixpQkFBaUI7Ozs7MEJBQ2YsZ0JBQWdCOzs7OzhCQUNmLG9CQUFvQjs7Ozs2QkFDbkIsbUJBQW1COztBQUMzQyxTQUFTLGtCQUFrQixDQUFFLElBQUksRUFBRztBQUNsQyxTQUFPLFVBQUMsQ0FBQyxFQUFFLENBQUMsRUFBRSxRQUFRLEVBQUs7QUFDekIsUUFBSSxNQUFNLEdBQUcsRUFBRSxDQUFBO0FBQ2YsVUFBTSxDQUFFLElBQUksQ0FBRSxHQUFHLENBQUMsQ0FBQyxNQUFNLENBQUMsS0FBSyxDQUFBO0FBQy9CLFlBQVEsQ0FBRSxNQUFNLENBQUUsQ0FBQTtHQUNuQixDQUFBO0NBQ0Y7O0FBRUQsU0FBUyxZQUFZLENBQUUsQ0FBQyxFQUFFLFNBQVMsRUFBRSxRQUFRLEVBQUc7QUFDOUMsR0FBQyxDQUFDLGNBQWMsRUFBRSxDQUFBO0FBQ2xCLFVBQVEsQ0FBQyxFQUFFLFVBQVUsRUFBRSxJQUFJLEVBQUUsQ0FBQyxDQUFBO0FBQzlCLDhCQUFXLFFBQVEsQ0FBQztBQUNsQixjQUFVLEVBQUcsdUJBQVEsS0FBSztBQUMxQixZQUFRLEVBQUssU0FBUyxDQUFDLEtBQUssQ0FBQyxRQUFRO0FBQ3JDLFlBQVEsRUFBSyxTQUFTLENBQUMsS0FBSyxDQUFDLFFBQVE7R0FDdEMsQ0FBQyxDQUFBO0NBQ0g7O0FBRUQsSUFBSSxZQUFZLEdBQUcsU0FBZixZQUFZLEdBQVM7QUFDdkIsU0FBTztBQUNMLFlBQVEsRUFBSyxFQUFFO0FBQ2YsWUFBUSxFQUFLLEVBQUU7QUFDZixjQUFVLEVBQUcsS0FBSztBQUNsQixTQUFLLEVBQVEsRUFBRTtHQUNoQixDQUFBO0NBQ0YsQ0FBQTtBQUNELElBQUksVUFBVSxHQUFHLFNBQWIsVUFBVSxDQUFJLENBQUMsRUFBRSxFQUFFLEVBQUUsUUFBUSxFQUFLO0FBQ3BDLE1BQUksRUFBRSxHQUFHLFNBQUwsRUFBRSxDQUFHLEtBQUs7V0FBSSxRQUFRLENBQUM7QUFDekIsZ0JBQVUsRUFBRyxLQUFLO0FBQ2xCLFdBQUssRUFBUSxLQUFLO0tBQ25CLENBQUM7R0FBQSxDQUFBO0FBQ0YsMEJBQVUsRUFBRSxDQUFDLGVBQWUsRUFBRSxFQUFFLENBQUMsQ0FBQTtBQUNqQyxVQUFRLENBQUMsRUFBRSxZQUFZLEVBQUUsRUFBRSxFQUFFLENBQUMsQ0FBQTtDQUMvQixDQUFBOztBQUVELElBQUksYUFBYSxHQUFHLFNBQWhCLGFBQWEsQ0FBSSxDQUFDLEVBQUs7QUFDekIsMEJBQVUsY0FBYyxDQUFDLGVBQWUsRUFBRSxDQUFDLENBQUMsS0FBSyxDQUFDLFlBQVksQ0FBQyxDQUFBO0NBQ2hFLENBQUE7O0FBRUQsSUFBSSxNQUFNLEdBQUcsU0FBVCxNQUFNLENBQUcsQ0FBQyxFQUFJO01BQ1YsS0FBSyxHQUFZLENBQUMsQ0FBbEIsS0FBSztNQUFFLEtBQUssR0FBSyxDQUFDLENBQVgsS0FBSzs7QUFDbEIsTUFBSSxhQUFhLEdBQUcsT0FBTyxDQUFBO0FBQzNCLE1BQUssS0FBSyxDQUFDLFVBQVUsRUFBRztBQUN0QixpQkFBYSxHQUFJLDBDQUFLLEdBQUcsRUFBQyxrQkFBa0IsRUFBQyxHQUFHLEVBQUMsZUFBZSxHQUFHLEFBQUMsQ0FBQTtHQUNyRTs7QUFFRCxTQUNFOztNQUFLLFNBQU0sWUFBWTtJQUNyQjs7UUFBTSxRQUFRLEVBQUUsWUFBWSxBQUFDLEVBQUMsU0FBTSxXQUFXO01BQzdDOztVQUFHLFNBQU0sT0FBTztRQUFFLEtBQUssQ0FBQyxLQUFLO09BQUs7TUFDbEMsNENBQU8sSUFBSSxFQUFDLE1BQU0sRUFBQyxRQUFRLEVBQUUsa0JBQWtCLENBQUMsVUFBVSxDQUFDLEFBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLFFBQVEsQUFBQyxFQUFDLFdBQVcsRUFBQyxVQUFVLEdBQUc7TUFDN0csNENBQU8sSUFBSSxFQUFDLFVBQVUsRUFBQyxRQUFRLEVBQUUsa0JBQWtCLENBQUMsVUFBVSxDQUFDLEFBQUMsRUFBQyxLQUFLLEVBQUUsS0FBSyxDQUFDLFFBQVEsQUFBQyxFQUFDLFdBQVcsRUFBQyxVQUFVLEdBQUc7TUFDakg7O1VBQVEsSUFBSSxFQUFDLFFBQVE7UUFBRSxhQUFhO09BQVU7S0FDekM7SUFDUDs7UUFBRyxTQUFNLG1CQUFtQjtNQUFDOztVQUFHLElBQUksRUFBQyxTQUFTOztPQUFxQjtLQUFJO0dBQ25FLENBQ1A7Q0FDRixDQUFBO0FBQ0QsSUFBSSxTQUFTLEdBQUc7QUFDZCxjQUFZLEVBQVosWUFBWTtBQUNaLFlBQVUsRUFBVixVQUFVO0FBQ1YsZUFBYSxFQUFiLGFBQWE7QUFDYixRQUFNLEVBQU4sTUFBTTtDQUNQLENBQUE7cUJBQ2MsU0FBUzs7Ozs7Ozs7Ozs7Ozs7Ozt3QkNwRUQsVUFBVTs7MEJBQ1gsZ0JBQWdCOzs7O2dDQUNuQixzQkFBc0I7Ozs7NkJBQ2pCLG1CQUFtQjs7aUNBQ3ZCLHdCQUF3Qjs7OzttQ0FDdEIsMEJBQTBCOzs7OzhCQUN6QixvQkFBb0I7Ozs7SUFFckMsV0FBVztBQUNKLFdBRFAsV0FBVyxHQUNEOzs7MEJBRFYsV0FBVzs7QUFFYixrQ0FBTyxJQUFJLEVBQUUsQ0FBQTtBQUNiLFFBQUksQ0FBQyxNQUFNLEdBQUcsc0JBQU87QUFDbkIsU0FBRyxFQUFFLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsR0FBRyxDQUFDO0FBQzVCLGNBQVEsRUFBRSxDQUFDLElBQUksQ0FBQyxRQUFRLEVBQUUsSUFBSSxDQUFDLEtBQUssQ0FBQztBQUNyQyxlQUFTLEVBQUUsQ0FBQyxJQUFJLENBQUMsUUFBUSxFQUFFLElBQUksQ0FBQyxNQUFNLENBQUM7QUFDdkMsZUFBUyxFQUFFLENBQUMsSUFBSSxDQUFDLE1BQU0sRUFBRSxJQUFJLENBQUMsTUFBTSxDQUFDO0tBQ3RDLENBQUMsQ0FBQTtBQUNGLFFBQUksQ0FBQyxNQUFNLENBQUMsSUFBSSxFQUFFLENBQUE7QUFDbEIsNEJBQVUsRUFBRSxDQUFDLGVBQWUsRUFBRTthQUFNLE1BQUssTUFBTSxDQUFDLFFBQVEsQ0FBQyxHQUFHLENBQUM7S0FBQSxDQUFFLENBQUE7R0FDaEU7O2VBWEcsV0FBVzs7V0FhVixpQkFBRyxFQUNQOzs7V0FFSyxrQkFBRztBQUNQLFVBQUksQ0FBQyx3QkFBVSxlQUFlLEVBQUUsRUFBRTtBQUNoQyxZQUFJLENBQUMsUUFBUSxDQUFDLFFBQVEsQ0FBQyxDQUFBO09BQ3hCO0tBQ0Y7OztXQUVPLG9CQUFHO0FBQ1QsVUFBSSx3QkFBVSxlQUFlLEVBQUUsRUFBRTtBQUMvQixZQUFJLENBQUMsUUFBUSxDQUFDLEdBQUcsQ0FBQyxDQUFBO09BQ25CO0tBQ0Y7OztXQUVFLGVBQUc7QUFDSixrQ0FBVyxRQUFRLENBQUM7QUFDbEIsa0JBQVUsRUFBRSx1QkFBUSxjQUFjO09BQ25DLENBQUMsQ0FBQTtBQUNGLGtDQUFXLFFBQVEsQ0FBQztBQUNsQixrQkFBVSxFQUFHLHVCQUFRLFFBQVE7QUFDN0IsWUFBSSxnQ0FBWTtPQUNqQixDQUFDLENBQUE7S0FDSDs7O1dBRUksaUJBQUc7QUFDTixrQ0FBVyxRQUFRLENBQUM7QUFDbEIsa0JBQVUsRUFBRyx1QkFBUSxRQUFRO0FBQzdCLFlBQUksa0NBQWM7T0FDbkIsQ0FBQyxDQUFBO0tBQ0g7OztXQUNLLGtCQUFHO0FBQ1Asa0NBQVcsUUFBUSxDQUFDO0FBQ2xCLGtCQUFVLEVBQUUsdUJBQVEsTUFBTTtPQUMzQixDQUFDLENBQUE7S0FDSDs7O1dBRUssa0JBQUc7QUFDUCxrQ0FBVyxRQUFRLENBQUM7QUFDbEIsa0JBQVUsRUFBRyx1QkFBUSxRQUFRO0FBQzdCLFlBQUksRUFBSyxRQUFRO09BQ2xCLENBQUMsQ0FBQTtLQUNIOzs7U0F2REcsV0FBVzs7O3FCQTBERixJQUFJLFdBQVcsRUFBQTs7Ozs7O0FDbEU5QixNQUFNLENBQUMsT0FBTyxHQUFHO0FBQ2YsU0FBTyxFQUFTLHVCQUF1QjtBQUN2QyxhQUFXLEVBQUssYUFBYTtBQUM3QixlQUFhLEVBQUcsVUFBVTtBQUMxQixTQUFPLEVBQVM7QUFDZCxZQUFRLEVBQVksVUFBVTtBQUM5QixTQUFLLEVBQWUsT0FBTztBQUMzQixVQUFNLEVBQWMsUUFBUTtBQUM1QixVQUFNLEVBQWMsUUFBUTtBQUM1QixrQkFBYyxFQUFTLGdCQUFnQjtBQUN2QyxtQkFBZSxFQUFTLGlCQUFpQjtBQUN6QyxtQkFBZSxFQUFTLGlCQUFpQjtBQUN6QyxvQkFBZ0IsRUFBUyxrQkFBa0I7R0FDNUM7Q0FDRixDQUFDOzs7Ozs7Ozs7OztvQkNkZSxNQUFNOzs7O3FCQUNSLElBQUksa0JBQUssVUFBVSxFQUFFOzs7Ozs7Ozs7Ozs7Ozs7Ozs7SUNEdkIsWUFBWTtZQUFaLFlBQVk7O0FBQ1osV0FEQSxZQUFZLENBQ1YsVUFBVSxFQUFFLE9BQU8sRUFBRzswQkFEeEIsWUFBWTs7QUFFckIsK0JBRlMsWUFBWSw2Q0FFYjtBQUNSLFFBQUksQ0FBQyxJQUFJLEdBQVMsY0FBYyxDQUFDO0FBQ2pDLFFBQUksQ0FBQyxPQUFPLEdBQU0sT0FBTyxJQUFJLG9CQUFvQixDQUFDO0FBQ2xELFFBQUksQ0FBQyxVQUFVLEdBQUcsVUFBVSxJQUFJLEdBQUcsQ0FBQztBQUNwQyxRQUFJLENBQUMsS0FBSyxHQUFRLEFBQUMsSUFBSSxLQUFLLEVBQUUsQ0FBRSxLQUFLLENBQUM7R0FDdkM7O1NBUFUsWUFBWTtHQUFTLEtBQUs7Ozs7SUFVMUIsZUFBZTtZQUFmLGVBQWU7O0FBQ2YsV0FEQSxlQUFlLENBQ2IsT0FBTyxFQUFHOzBCQURaLGVBQWU7O0FBRXhCLCtCQUZTLGVBQWUsNkNBRWpCLEdBQUcsRUFBRSxhQUFhLEVBQUc7QUFDNUIsUUFBSSxDQUFDLElBQUksR0FBTSxpQkFBaUIsQ0FBQztBQUNqQyxRQUFJLENBQUMsT0FBTyxHQUFHLE9BQU8sQ0FBQztHQUN4Qjs7U0FMVSxlQUFlO0dBQVMsWUFBWTs7OztJQVFwQyxpQkFBaUI7WUFBakIsaUJBQWlCOztBQUNqQixXQURBLGlCQUFpQixHQUNkOzBCQURILGlCQUFpQjs7QUFFMUIsK0JBRlMsaUJBQWlCLDZDQUVuQixHQUFHLEVBQUUsY0FBYyxFQUFHO0FBQzdCLFFBQUksQ0FBQyxJQUFJLEdBQUcsbUJBQW1CLENBQUM7R0FDakM7O1NBSlUsaUJBQWlCO0dBQVMsWUFBWTs7OztJQU90QyxjQUFjO1lBQWQsY0FBYzs7QUFDZCxXQURBLGNBQWMsR0FDWDswQkFESCxjQUFjOztBQUV2QiwrQkFGUyxjQUFjLDZDQUVoQixHQUFHLEVBQUUsV0FBVyxFQUFHO0FBQzFCLFFBQUksQ0FBQyxJQUFJLEdBQUcsZ0JBQWdCLENBQUM7R0FDOUI7O1NBSlUsY0FBYztHQUFTLFlBQVk7Ozs7SUFPbkMsYUFBYTtZQUFiLGFBQWE7O0FBQ2IsV0FEQSxhQUFhLEdBQ1Y7MEJBREgsYUFBYTs7QUFFdEIsK0JBRlMsYUFBYSw2Q0FFZixHQUFHLEVBQUUsV0FBVyxFQUFHO0FBQzFCLFFBQUksQ0FBQyxJQUFJLEdBQUcsZUFBZSxDQUFDO0dBQzdCOztTQUpVLGFBQWE7R0FBUyxZQUFZOzs7O0lBT2xDLHFCQUFxQjtZQUFyQixxQkFBcUI7O0FBQ3JCLFdBREEscUJBQXFCLEdBQ2xCOzBCQURILHFCQUFxQjs7QUFFOUIsK0JBRlMscUJBQXFCLDZDQUV2QixHQUFHLEVBQUUsb0JBQW9CLEVBQUc7QUFDbkMsUUFBSSxDQUFDLElBQUksR0FBRyx1QkFBdUIsQ0FBQztHQUNyQzs7U0FKVSxxQkFBcUI7R0FBUyxZQUFZOzs7O0FBT2hELFNBQVMsWUFBWSxDQUFFLEdBQUcsRUFBRztBQUNsQyxNQUFLLEdBQUcsQ0FBQyxNQUFNLEVBQUc7QUFDaEIsWUFBUyxHQUFHLENBQUMsTUFBTTtBQUNqQixXQUFLLEdBQUc7QUFDTixlQUFPLElBQUksZUFBZSxFQUFFLENBQUM7QUFDN0IsY0FBTTs7QUFBQSxBQUVSLFdBQUssR0FBRztBQUNOLGVBQU8sSUFBSSxpQkFBaUIsRUFBRSxDQUFDO0FBQy9CLGNBQU07O0FBQUEsQUFFUixXQUFLLEdBQUc7QUFDTixlQUFPLElBQUksY0FBYyxFQUFFLENBQUM7QUFDNUIsY0FBTTs7QUFBQSxBQUVSLFdBQUssR0FBRztBQUNOLGVBQU8sSUFBSSxhQUFhLEVBQUUsQ0FBQztBQUMzQixjQUFNOztBQUFBLEFBRVIsV0FBSyxHQUFHO0FBQ04sZUFBTyxJQUFJLHFCQUFxQixFQUFFLENBQUM7QUFDbkMsY0FBTTs7QUFBQSxBQUVSO0FBQ0UsZUFBTyxJQUFJLFlBQVksQ0FBRSxHQUFHLENBQUMsTUFBTSxFQUFFLEdBQUcsQ0FBQyxVQUFVLENBQUUsQ0FBQztBQUN0RCxjQUFNO0FBQUEsS0FDVDtHQUNGLE1BQU07O0FBRUwsV0FBTyxHQUFHLENBQUM7R0FDWjtDQUNGOzs7Ozs7Ozs7OztxQkM3RWlCLE9BQU87Ozs7NkJBQ0QsbUJBQW1COztxQkFFNUI7QUFDYixPQUFLLEVBQUUsZUFBQSxJQUFJO1dBQUksbUJBQU0sR0FBRyx5Q0FBMEIsSUFBSSxDQUFDO0dBQUE7Q0FDeEQ7Ozs7Ozs7Ozs7OztxQkNMaUIsT0FBTzs7Ozs2QkFDRCxtQkFBbUI7O3lCQUNyQixXQUFXOzs7O0FBRWpDLFNBQVMsUUFBUSxDQUFDLElBQUksRUFBRSxFQUN2Qjs7QUFFRCxJQUFJLFFBQVEsR0FBRyx5QkFBVSxZQUFZLENBQUE7cUJBQ3RCO0FBQ2IsTUFBSSxFQUFLO1dBQVksbUJBQU0sR0FBRyxDQUFFLFFBQVEsQ0FBRTtHQUFBO0FBQzFDLE9BQUssRUFBSSxlQUFDLEVBQUU7V0FBUyxtQkFBTSxHQUFHLENBQUUsUUFBUSxVQUFPLEVBQUUsQ0FBRSxDQUFFO0dBQUE7QUFDckQsUUFBTSxFQUFHLGdCQUFDLElBQUk7V0FBUyxtQkFBTSxJQUFJLENBQUUsUUFBUSxFQUFFLElBQUksQ0FBRTtHQUFBO0FBQ25ELFFBQU0sRUFBRyxnQkFBQyxFQUFFLEVBQUUsSUFBSTtXQUFLLG1CQUFNLEdBQUcsQ0FBRSxRQUFRLFVBQU8sRUFBRSxDQUFFLEVBQUUsSUFBSSxDQUFFO0dBQUE7QUFDN0QsWUFBUyxpQkFBQyxFQUFFO1dBQVcsNEJBQVksQ0FBRSxRQUFRLFVBQU8sRUFBRSxDQUFFLENBQUU7R0FBQTtDQUMzRDs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7NkJDQ21ELG1CQUFtQjs7OEJBQ2hELG9CQUFvQjs7OzswQkFDeEIsZ0JBQWdCOzs7O3dCQUNqQixjQUFjOzs7O3NCQUNILFFBQVE7O0lBRS9CLFNBQVM7WUFBVCxTQUFTOztBQUVGLFdBRlAsU0FBUyxHQUVDOzs7MEJBRlYsU0FBUzs7QUFHWCwrQkFIRSxTQUFTLDZDQUdKO0FBQ1AsUUFBSSxDQUFDLFVBQVUsR0FBRyxJQUFJLENBQUE7QUFDdEIsUUFBSSxDQUFDLGtCQUFrQixHQUFHLElBQUksQ0FBQTtBQUM5QixRQUFJLElBQUksR0FBRyxJQUFJLENBQUMsV0FBVyxFQUFFLENBQUE7QUFDN0IsUUFBSSxJQUFJLElBQUksSUFBSSxDQUFDLEtBQUssSUFBSSxJQUFJLENBQUMsSUFBSSxFQUNqQyxJQUFJLENBQUMsWUFBWSxDQUFDLElBQUksQ0FBQyxDQUFBOztBQUV6QixnQ0FBVyxRQUFRLENBQUMsVUFBQSxNQUFNLEVBQUk7QUFDNUIsY0FBUSxNQUFNLENBQUMsVUFBVTtBQUN2QixhQUFLLHVCQUFRLEtBQUs7QUFDaEIsaUJBQU8sTUFBSyxXQUFXLENBQUMsTUFBTSxDQUFDLENBQUE7QUFBQSxBQUNqQyxhQUFLLHVCQUFRLE1BQU07QUFDakIsaUJBQU8sTUFBSyxZQUFZLENBQUMsTUFBTSxDQUFDLENBQUE7QUFBQSxPQUNuQztLQUNGLENBQUMsQ0FBQTtHQUNIOzs7O2VBbEJHLFNBQVM7O1dBb0JGLHVCQUFFO0FBQ1gsYUFBTyxJQUFJLENBQUMsS0FBSyxDQUFFLGNBQWMsQ0FBQyxPQUFPLDhCQUFlLENBQUMsQ0FBQTtLQUMxRDs7O1dBQ1UscUJBQUMsSUFBSSxFQUFFO0FBQ2hCLG9CQUFjLENBQUMsT0FBTywrQkFBZ0IsSUFBSSxDQUFDLFNBQVMsQ0FBQyxJQUFJLENBQUMsQ0FBQyxDQUFBO0tBQzVEOzs7V0FDWSx5QkFBRztBQUNkLG9CQUFjLENBQUMsVUFBVSw4QkFBZSxDQUFBO0tBQ3pDOzs7V0FDYywyQkFBRztBQUNoQixhQUFPLE9BQU8sSUFBSSxDQUFDLFVBQVUsS0FBSyxRQUFRLENBQUE7S0FDM0M7OztXQUVXLHNCQUFDLElBQUksRUFBRTtBQUNqQixVQUFJLENBQUMsV0FBVyxDQUFDLElBQUksQ0FBQyxDQUFBO0FBQ3RCLFVBQUksQ0FBQyxVQUFVLEdBQUcsSUFBSSxDQUFDLEtBQUssQ0FBQTtBQUM1QixVQUFJLENBQUMsa0JBQWtCLEdBQUcsSUFBSSxDQUFDLElBQUksQ0FBQTtLQUNwQzs7O1dBRWdCLHFCQUFDLE1BQU07Z0JBRWYsSUFBSTs7Ozs7Ozs0Q0FBVSxzQkFBTSxLQUFLLENBQUM7QUFDN0Isc0JBQVEsRUFBRSxNQUFNLENBQUMsUUFBUTtBQUN6QixzQkFBUSxFQUFFLE1BQU0sQ0FBQyxRQUFRO2FBQzFCLENBQUM7Ozs7QUFIRyxnQkFBSSxRQUFKLElBQUk7O0FBSVQsZ0JBQUksQ0FBQyxZQUFZLENBQUMsSUFBSSxDQUFDLENBQUE7QUFDdkIsZ0JBQUksQ0FBQyxJQUFJLENBQUUsZUFBZSxFQUFFLElBQUksQ0FBRSxDQUFBOzs7Ozs7OztBQUVsQyxnQkFBSywwQkFBYSx3QkFBTyxpQkFBaUIsRUFBRztBQUMzQyxrQkFBSSxDQUFDLElBQUksQ0FBRSxlQUFlLEVBQUUsZ0NBQWdDLENBQUUsQ0FBQTthQUMvRCxNQUFNLElBQUssMEJBQWEsd0JBQU8sY0FBYyxFQUFHO0FBQy9DLGtCQUFJLENBQUMsSUFBSSxDQUFFLGdCQUFnQixDQUFFLENBQUE7YUFDOUIsTUFBTSxJQUFLLDBCQUFhLHdCQUFPLGFBQWEsRUFBRztBQUM5QyxrQkFBSSxDQUFDLElBQUksQ0FBRSxlQUFlLEVBQUUsZ0NBQWdDLENBQUUsQ0FBQTthQUMvRCxNQUFNO0FBQ0wscUJBQU8sQ0FBQyxLQUFLLENBQUUsZUFBRSxLQUFLLENBQUUsQ0FBQTthQUN6Qjs7Ozs7OztLQUVKOzs7V0FFaUIsc0JBQUMsTUFBTTs7OztBQUN2QixtQkFBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLEVBQUUsTUFBTSxDQUFDLENBQUE7QUFDbkMsZ0JBQUksQ0FBQyxhQUFhLEVBQUUsQ0FBQTtBQUNwQixnQkFBSSxDQUFDLFVBQVUsR0FBVyxJQUFJLENBQUE7QUFDOUIsZ0JBQUksQ0FBQyxrQkFBa0IsR0FBRyxJQUFJLENBQUE7QUFDOUIsZ0JBQUksQ0FBQyxJQUFJLENBQUUsZ0JBQWdCLENBQUUsQ0FBQTs7Ozs7OztLQUM5Qjs7O1NBbEVHLFNBQVM7OztxQkFvRUEsSUFBSSxTQUFTLEVBQUU7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs7Ozs2QkM1RUwsbUJBQW1COzs4QkFDckIsb0JBQW9COzs7OzZCQUNyQixtQkFBbUI7Ozs7c0JBRVosUUFBUTs7SUFHL0IsYUFBYTtZQUFiLGFBQWE7O0FBRU4sV0FGUCxhQUFhLEdBRUg7OzswQkFGVixhQUFhOztBQUdmLCtCQUhFLGFBQWEsNkNBR1I7QUFDUCxRQUFJLENBQUMsS0FBSyxHQUFHLEVBQUUsQ0FBQTtBQUNmLGdDQUFXLFFBQVEsQ0FBQyxVQUFBLE1BQU0sRUFBSTtBQUM1QixjQUFRLE1BQU0sQ0FBQyxVQUFVO0FBQ3ZCLGFBQUssdUJBQVEsY0FBYztBQUN6QixpQkFBTyxNQUFLLElBQUksQ0FBQyxNQUFNLENBQUMsQ0FBQTtBQUFBLE9BQzNCO0tBQ0YsQ0FBQyxDQUFBO0dBQ0g7O2VBWEcsYUFBYTs7V0FZUDtnQkFHQSxJQUFJOzs7OztBQUZaLG1CQUFPLENBQUMsR0FBRyxDQUFDLG1CQUFtQixDQUFDLENBQUE7Ozs0Q0FFVCwyQkFBVSxJQUFJLEVBQUU7Ozs7QUFBL0IsZ0JBQUksUUFBSixJQUFJOztBQUNWLGdCQUFJLENBQUMsS0FBSyxHQUFHLElBQUksQ0FBQTtBQUNqQixtQkFBTyxDQUFDLEdBQUcsQ0FBQyxjQUFjLEVBQUUsSUFBSSxDQUFDLENBQUE7QUFDakMsZ0JBQUksQ0FBQyxJQUFJLENBQUMsY0FBYyxDQUFDLENBQUE7Ozs7Ozs7O0FBRXpCLGdCQUFJLENBQUMsSUFBSSxDQUFDLGNBQWMsQ0FBQyxDQUFBOzs7Ozs7O0tBRTVCOzs7V0FDTyxvQkFBRztBQUNULGFBQU8sSUFBSSxDQUFDLEtBQUssQ0FBQTtLQUNsQjs7O1NBekJHLGFBQWE7OztxQkEyQkosSUFBSSxhQUFhLEVBQUUiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2xpYi9heGlvcycpOyIsIid1c2Ugc3RyaWN0JztcblxuLypnbG9iYWwgQWN0aXZlWE9iamVjdDp0cnVlKi9cblxudmFyIGRlZmF1bHRzID0gcmVxdWlyZSgnLi8uLi9kZWZhdWx0cycpO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi8uLi91dGlscycpO1xudmFyIGJ1aWxkVXJsID0gcmVxdWlyZSgnLi8uLi9oZWxwZXJzL2J1aWxkVXJsJyk7XG52YXIgcGFyc2VIZWFkZXJzID0gcmVxdWlyZSgnLi8uLi9oZWxwZXJzL3BhcnNlSGVhZGVycycpO1xudmFyIHRyYW5zZm9ybURhdGEgPSByZXF1aXJlKCcuLy4uL2hlbHBlcnMvdHJhbnNmb3JtRGF0YScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIHhockFkYXB0ZXIocmVzb2x2ZSwgcmVqZWN0LCBjb25maWcpIHtcbiAgLy8gVHJhbnNmb3JtIHJlcXVlc3QgZGF0YVxuICB2YXIgZGF0YSA9IHRyYW5zZm9ybURhdGEoXG4gICAgY29uZmlnLmRhdGEsXG4gICAgY29uZmlnLmhlYWRlcnMsXG4gICAgY29uZmlnLnRyYW5zZm9ybVJlcXVlc3RcbiAgKTtcblxuICAvLyBNZXJnZSBoZWFkZXJzXG4gIHZhciByZXF1ZXN0SGVhZGVycyA9IHV0aWxzLm1lcmdlKFxuICAgIGRlZmF1bHRzLmhlYWRlcnMuY29tbW9uLFxuICAgIGRlZmF1bHRzLmhlYWRlcnNbY29uZmlnLm1ldGhvZF0gfHwge30sXG4gICAgY29uZmlnLmhlYWRlcnMgfHwge31cbiAgKTtcblxuICBpZiAodXRpbHMuaXNGb3JtRGF0YShkYXRhKSkge1xuICAgIGRlbGV0ZSByZXF1ZXN0SGVhZGVyc1snQ29udGVudC1UeXBlJ107IC8vIExldCB0aGUgYnJvd3NlciBzZXQgaXRcbiAgfVxuXG4gIC8vIENyZWF0ZSB0aGUgcmVxdWVzdFxuICB2YXIgcmVxdWVzdCA9IG5ldyAoWE1MSHR0cFJlcXVlc3QgfHwgQWN0aXZlWE9iamVjdCkoJ01pY3Jvc29mdC5YTUxIVFRQJyk7XG4gIHJlcXVlc3Qub3Blbihjb25maWcubWV0aG9kLnRvVXBwZXJDYXNlKCksIGJ1aWxkVXJsKGNvbmZpZy51cmwsIGNvbmZpZy5wYXJhbXMpLCB0cnVlKTtcblxuICAvLyBTZXQgdGhlIHJlcXVlc3QgdGltZW91dCBpbiBNU1xuICByZXF1ZXN0LnRpbWVvdXQgPSBjb25maWcudGltZW91dDtcblxuICAvLyBMaXN0ZW4gZm9yIHJlYWR5IHN0YXRlXG4gIHJlcXVlc3Qub25yZWFkeXN0YXRlY2hhbmdlID0gZnVuY3Rpb24gKCkge1xuICAgIGlmIChyZXF1ZXN0ICYmIHJlcXVlc3QucmVhZHlTdGF0ZSA9PT0gNCkge1xuICAgICAgLy8gUHJlcGFyZSB0aGUgcmVzcG9uc2VcbiAgICAgIHZhciByZXNwb25zZUhlYWRlcnMgPSBwYXJzZUhlYWRlcnMocmVxdWVzdC5nZXRBbGxSZXNwb25zZUhlYWRlcnMoKSk7XG4gICAgICB2YXIgcmVzcG9uc2VEYXRhID0gWyd0ZXh0JywgJyddLmluZGV4T2YoY29uZmlnLnJlc3BvbnNlVHlwZSB8fCAnJykgIT09IC0xID8gcmVxdWVzdC5yZXNwb25zZVRleHQgOiByZXF1ZXN0LnJlc3BvbnNlO1xuICAgICAgdmFyIHJlc3BvbnNlID0ge1xuICAgICAgICBkYXRhOiB0cmFuc2Zvcm1EYXRhKFxuICAgICAgICAgIHJlc3BvbnNlRGF0YSxcbiAgICAgICAgICByZXNwb25zZUhlYWRlcnMsXG4gICAgICAgICAgY29uZmlnLnRyYW5zZm9ybVJlc3BvbnNlXG4gICAgICAgICksXG4gICAgICAgIHN0YXR1czogcmVxdWVzdC5zdGF0dXMsXG4gICAgICAgIHN0YXR1c1RleHQ6IHJlcXVlc3Quc3RhdHVzVGV4dCxcbiAgICAgICAgaGVhZGVyczogcmVzcG9uc2VIZWFkZXJzLFxuICAgICAgICBjb25maWc6IGNvbmZpZ1xuICAgICAgfTtcblxuICAgICAgLy8gUmVzb2x2ZSBvciByZWplY3QgdGhlIFByb21pc2UgYmFzZWQgb24gdGhlIHN0YXR1c1xuICAgICAgKHJlcXVlc3Quc3RhdHVzID49IDIwMCAmJiByZXF1ZXN0LnN0YXR1cyA8IDMwMCA/XG4gICAgICAgIHJlc29sdmUgOlxuICAgICAgICByZWplY3QpKHJlc3BvbnNlKTtcblxuICAgICAgLy8gQ2xlYW4gdXAgcmVxdWVzdFxuICAgICAgcmVxdWVzdCA9IG51bGw7XG4gICAgfVxuICB9O1xuXG4gIC8vIEFkZCB4c3JmIGhlYWRlclxuICAvLyBUaGlzIGlzIG9ubHkgZG9uZSBpZiBydW5uaW5nIGluIGEgc3RhbmRhcmQgYnJvd3NlciBlbnZpcm9ubWVudC5cbiAgLy8gU3BlY2lmaWNhbGx5IG5vdCBpZiB3ZSdyZSBpbiBhIHdlYiB3b3JrZXIsIG9yIHJlYWN0LW5hdGl2ZS5cbiAgaWYgKHV0aWxzLmlzU3RhbmRhcmRCcm93c2VyRW52KCkpIHtcbiAgICB2YXIgY29va2llcyA9IHJlcXVpcmUoJy4vLi4vaGVscGVycy9jb29raWVzJyk7XG4gICAgdmFyIHVybElzU2FtZU9yaWdpbiA9IHJlcXVpcmUoJy4vLi4vaGVscGVycy91cmxJc1NhbWVPcmlnaW4nKTtcblxuICAgIC8vIEFkZCB4c3JmIGhlYWRlclxuICAgIHZhciB4c3JmVmFsdWUgPSB1cmxJc1NhbWVPcmlnaW4oY29uZmlnLnVybCkgP1xuICAgICAgICBjb29raWVzLnJlYWQoY29uZmlnLnhzcmZDb29raWVOYW1lIHx8IGRlZmF1bHRzLnhzcmZDb29raWVOYW1lKSA6XG4gICAgICAgIHVuZGVmaW5lZDtcblxuICAgIGlmICh4c3JmVmFsdWUpIHtcbiAgICAgIHJlcXVlc3RIZWFkZXJzW2NvbmZpZy54c3JmSGVhZGVyTmFtZSB8fCBkZWZhdWx0cy54c3JmSGVhZGVyTmFtZV0gPSB4c3JmVmFsdWU7XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIGhlYWRlcnMgdG8gdGhlIHJlcXVlc3RcbiAgdXRpbHMuZm9yRWFjaChyZXF1ZXN0SGVhZGVycywgZnVuY3Rpb24gKHZhbCwga2V5KSB7XG4gICAgLy8gUmVtb3ZlIENvbnRlbnQtVHlwZSBpZiBkYXRhIGlzIHVuZGVmaW5lZFxuICAgIGlmICghZGF0YSAmJiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gJ2NvbnRlbnQtdHlwZScpIHtcbiAgICAgIGRlbGV0ZSByZXF1ZXN0SGVhZGVyc1trZXldO1xuICAgIH1cbiAgICAvLyBPdGhlcndpc2UgYWRkIGhlYWRlciB0byB0aGUgcmVxdWVzdFxuICAgIGVsc2Uge1xuICAgICAgcmVxdWVzdC5zZXRSZXF1ZXN0SGVhZGVyKGtleSwgdmFsKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIEFkZCB3aXRoQ3JlZGVudGlhbHMgdG8gcmVxdWVzdCBpZiBuZWVkZWRcbiAgaWYgKGNvbmZpZy53aXRoQ3JlZGVudGlhbHMpIHtcbiAgICByZXF1ZXN0LndpdGhDcmVkZW50aWFscyA9IHRydWU7XG4gIH1cblxuICAvLyBBZGQgcmVzcG9uc2VUeXBlIHRvIHJlcXVlc3QgaWYgbmVlZGVkXG4gIGlmIChjb25maWcucmVzcG9uc2VUeXBlKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJlcXVlc3QucmVzcG9uc2VUeXBlID0gY29uZmlnLnJlc3BvbnNlVHlwZTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAocmVxdWVzdC5yZXNwb25zZVR5cGUgIT09ICdqc29uJykge1xuICAgICAgICB0aHJvdyBlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmICh1dGlscy5pc0FycmF5QnVmZmVyKGRhdGEpKSB7XG4gICAgZGF0YSA9IG5ldyBEYXRhVmlldyhkYXRhKTtcbiAgfVxuXG4gIC8vIFNlbmQgdGhlIHJlcXVlc3RcbiAgcmVxdWVzdC5zZW5kKGRhdGEpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGRlZmF1bHRzID0gcmVxdWlyZSgnLi9kZWZhdWx0cycpO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xudmFyIGRpc3BhdGNoUmVxdWVzdCA9IHJlcXVpcmUoJy4vY29yZS9kaXNwYXRjaFJlcXVlc3QnKTtcbnZhciBJbnRlcmNlcHRvck1hbmFnZXIgPSByZXF1aXJlKCcuL2NvcmUvSW50ZXJjZXB0b3JNYW5hZ2VyJyk7XG5cbnZhciBheGlvcyA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGNvbmZpZykge1xuICAvLyBBbGxvdyBmb3IgYXhpb3MoJ2V4YW1wbGUvdXJsJ1ssIGNvbmZpZ10pIGEgbGEgZmV0Y2ggQVBJXG4gIGlmICh0eXBlb2YgY29uZmlnID09PSAnc3RyaW5nJykge1xuICAgIGNvbmZpZyA9IHV0aWxzLm1lcmdlKHtcbiAgICAgIHVybDogYXJndW1lbnRzWzBdXG4gICAgfSwgYXJndW1lbnRzWzFdKTtcbiAgfVxuXG4gIGNvbmZpZyA9IHV0aWxzLm1lcmdlKHtcbiAgICBtZXRob2Q6ICdnZXQnLFxuICAgIGhlYWRlcnM6IHt9LFxuICAgIHRpbWVvdXQ6IGRlZmF1bHRzLnRpbWVvdXQsXG4gICAgdHJhbnNmb3JtUmVxdWVzdDogZGVmYXVsdHMudHJhbnNmb3JtUmVxdWVzdCxcbiAgICB0cmFuc2Zvcm1SZXNwb25zZTogZGVmYXVsdHMudHJhbnNmb3JtUmVzcG9uc2VcbiAgfSwgY29uZmlnKTtcblxuICAvLyBEb24ndCBhbGxvdyBvdmVycmlkaW5nIGRlZmF1bHRzLndpdGhDcmVkZW50aWFsc1xuICBjb25maWcud2l0aENyZWRlbnRpYWxzID0gY29uZmlnLndpdGhDcmVkZW50aWFscyB8fCBkZWZhdWx0cy53aXRoQ3JlZGVudGlhbHM7XG5cbiAgLy8gSG9vayB1cCBpbnRlcmNlcHRvcnMgbWlkZGxld2FyZVxuICB2YXIgY2hhaW4gPSBbZGlzcGF0Y2hSZXF1ZXN0LCB1bmRlZmluZWRdO1xuICB2YXIgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZShjb25maWcpO1xuXG4gIGF4aW9zLmludGVyY2VwdG9ycy5yZXF1ZXN0LmZvckVhY2goZnVuY3Rpb24gKGludGVyY2VwdG9yKSB7XG4gICAgY2hhaW4udW5zaGlmdChpbnRlcmNlcHRvci5mdWxmaWxsZWQsIGludGVyY2VwdG9yLnJlamVjdGVkKTtcbiAgfSk7XG5cbiAgYXhpb3MuaW50ZXJjZXB0b3JzLnJlc3BvbnNlLmZvckVhY2goZnVuY3Rpb24gKGludGVyY2VwdG9yKSB7XG4gICAgY2hhaW4ucHVzaChpbnRlcmNlcHRvci5mdWxmaWxsZWQsIGludGVyY2VwdG9yLnJlamVjdGVkKTtcbiAgfSk7XG5cbiAgd2hpbGUgKGNoYWluLmxlbmd0aCkge1xuICAgIHByb21pc2UgPSBwcm9taXNlLnRoZW4oY2hhaW4uc2hpZnQoKSwgY2hhaW4uc2hpZnQoKSk7XG4gIH1cblxuICByZXR1cm4gcHJvbWlzZTtcbn07XG5cbi8vIEV4cG9zZSBkZWZhdWx0c1xuYXhpb3MuZGVmYXVsdHMgPSBkZWZhdWx0cztcblxuLy8gRXhwb3NlIGFsbC9zcHJlYWRcbmF4aW9zLmFsbCA9IGZ1bmN0aW9uIChwcm9taXNlcykge1xuICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xufTtcbmF4aW9zLnNwcmVhZCA9IHJlcXVpcmUoJy4vaGVscGVycy9zcHJlYWQnKTtcblxuLy8gRXhwb3NlIGludGVyY2VwdG9yc1xuYXhpb3MuaW50ZXJjZXB0b3JzID0ge1xuICByZXF1ZXN0OiBuZXcgSW50ZXJjZXB0b3JNYW5hZ2VyKCksXG4gIHJlc3BvbnNlOiBuZXcgSW50ZXJjZXB0b3JNYW5hZ2VyKClcbn07XG5cbi8vIFByb3ZpZGUgYWxpYXNlcyBmb3Igc3VwcG9ydGVkIHJlcXVlc3QgbWV0aG9kc1xuKGZ1bmN0aW9uICgpIHtcbiAgZnVuY3Rpb24gY3JlYXRlU2hvcnRNZXRob2RzKCkge1xuICAgIHV0aWxzLmZvckVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAobWV0aG9kKSB7XG4gICAgICBheGlvc1ttZXRob2RdID0gZnVuY3Rpb24gKHVybCwgY29uZmlnKSB7XG4gICAgICAgIHJldHVybiBheGlvcyh1dGlscy5tZXJnZShjb25maWcgfHwge30sIHtcbiAgICAgICAgICBtZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgICB1cmw6IHVybFxuICAgICAgICB9KSk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gY3JlYXRlU2hvcnRNZXRob2RzV2l0aERhdGEoKSB7XG4gICAgdXRpbHMuZm9yRWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChtZXRob2QpIHtcbiAgICAgIGF4aW9zW21ldGhvZF0gPSBmdW5jdGlvbiAodXJsLCBkYXRhLCBjb25maWcpIHtcbiAgICAgICAgcmV0dXJuIGF4aW9zKHV0aWxzLm1lcmdlKGNvbmZpZyB8fCB7fSwge1xuICAgICAgICAgIG1ldGhvZDogbWV0aG9kLFxuICAgICAgICAgIHVybDogdXJsLFxuICAgICAgICAgIGRhdGE6IGRhdGFcbiAgICAgICAgfSkpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGNyZWF0ZVNob3J0TWV0aG9kcygnZGVsZXRlJywgJ2dldCcsICdoZWFkJyk7XG4gIGNyZWF0ZVNob3J0TWV0aG9kc1dpdGhEYXRhKCdwb3N0JywgJ3B1dCcsICdwYXRjaCcpO1xufSkoKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi8uLi91dGlscycpO1xuXG5mdW5jdGlvbiBJbnRlcmNlcHRvck1hbmFnZXIoKSB7XG4gIHRoaXMuaGFuZGxlcnMgPSBbXTtcbn1cblxuLyoqXG4gKiBBZGQgYSBuZXcgaW50ZXJjZXB0b3IgdG8gdGhlIHN0YWNrXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVsZmlsbGVkIFRoZSBmdW5jdGlvbiB0byBoYW5kbGUgYHRoZW5gIGZvciBhIGBQcm9taXNlYFxuICogQHBhcmFtIHtGdW5jdGlvbn0gcmVqZWN0ZWQgVGhlIGZ1bmN0aW9uIHRvIGhhbmRsZSBgcmVqZWN0YCBmb3IgYSBgUHJvbWlzZWBcbiAqXG4gKiBAcmV0dXJuIHtOdW1iZXJ9IEFuIElEIHVzZWQgdG8gcmVtb3ZlIGludGVyY2VwdG9yIGxhdGVyXG4gKi9cbkludGVyY2VwdG9yTWFuYWdlci5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24gKGZ1bGZpbGxlZCwgcmVqZWN0ZWQpIHtcbiAgdGhpcy5oYW5kbGVycy5wdXNoKHtcbiAgICBmdWxmaWxsZWQ6IGZ1bGZpbGxlZCxcbiAgICByZWplY3RlZDogcmVqZWN0ZWRcbiAgfSk7XG4gIHJldHVybiB0aGlzLmhhbmRsZXJzLmxlbmd0aCAtIDE7XG59O1xuXG4vKipcbiAqIFJlbW92ZSBhbiBpbnRlcmNlcHRvciBmcm9tIHRoZSBzdGFja1xuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBpZCBUaGUgSUQgdGhhdCB3YXMgcmV0dXJuZWQgYnkgYHVzZWBcbiAqL1xuSW50ZXJjZXB0b3JNYW5hZ2VyLnByb3RvdHlwZS5lamVjdCA9IGZ1bmN0aW9uIChpZCkge1xuICBpZiAodGhpcy5oYW5kbGVyc1tpZF0pIHtcbiAgICB0aGlzLmhhbmRsZXJzW2lkXSA9IG51bGw7XG4gIH1cbn07XG5cbi8qKlxuICogSXRlcmF0ZSBvdmVyIGFsbCB0aGUgcmVnaXN0ZXJlZCBpbnRlcmNlcHRvcnNcbiAqXG4gKiBUaGlzIG1ldGhvZCBpcyBwYXJ0aWN1bGFybHkgdXNlZnVsIGZvciBza2lwcGluZyBvdmVyIGFueVxuICogaW50ZXJjZXB0b3JzIHRoYXQgbWF5IGhhdmUgYmVjb21lIGBudWxsYCBjYWxsaW5nIGByZW1vdmVgLlxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIFRoZSBmdW5jdGlvbiB0byBjYWxsIGZvciBlYWNoIGludGVyY2VwdG9yXG4gKi9cbkludGVyY2VwdG9yTWFuYWdlci5wcm90b3R5cGUuZm9yRWFjaCA9IGZ1bmN0aW9uIChmbikge1xuICB1dGlscy5mb3JFYWNoKHRoaXMuaGFuZGxlcnMsIGZ1bmN0aW9uIChoKSB7XG4gICAgaWYgKGggIT09IG51bGwpIHtcbiAgICAgIGZuKGgpO1xuICAgIH1cbiAgfSk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEludGVyY2VwdG9yTWFuYWdlcjtcbiIsIid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiBEaXNwYXRjaCBhIHJlcXVlc3QgdG8gdGhlIHNlcnZlciB1c2luZyB3aGljaGV2ZXIgYWRhcHRlclxuICogaXMgc3VwcG9ydGVkIGJ5IHRoZSBjdXJyZW50IGVudmlyb25tZW50LlxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSBjb25maWcgVGhlIGNvbmZpZyB0aGF0IGlzIHRvIGJlIHVzZWQgZm9yIHRoZSByZXF1ZXN0XG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gVGhlIFByb21pc2UgdG8gYmUgZnVsZmlsbGVkXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZGlzcGF0Y2hSZXF1ZXN0KGNvbmZpZykge1xuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgIHRyeSB7XG4gICAgICAvLyBGb3IgYnJvd3NlcnMgdXNlIFhIUiBhZGFwdGVyXG4gICAgICBpZiAoKHR5cGVvZiBYTUxIdHRwUmVxdWVzdCAhPT0gJ3VuZGVmaW5lZCcpIHx8ICh0eXBlb2YgQWN0aXZlWE9iamVjdCAhPT0gJ3VuZGVmaW5lZCcpKSB7XG4gICAgICAgIHJlcXVpcmUoJy4uL2FkYXB0ZXJzL3hocicpKHJlc29sdmUsIHJlamVjdCwgY29uZmlnKTtcbiAgICAgIH1cbiAgICAgIC8vIEZvciBub2RlIHVzZSBIVFRQIGFkYXB0ZXJcbiAgICAgIGVsc2UgaWYgKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICByZXF1aXJlKCcuLi9hZGFwdGVycy9odHRwJykocmVzb2x2ZSwgcmVqZWN0LCBjb25maWcpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHJlamVjdChlKTtcbiAgICB9XG4gIH0pO1xufTtcblxuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XG5cbnZhciBQUk9URUNUSU9OX1BSRUZJWCA9IC9eXFwpXFxdXFx9Jyw/XFxuLztcbnZhciBERUZBVUxUX0NPTlRFTlRfVFlQRSA9IHtcbiAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgdHJhbnNmb3JtUmVxdWVzdDogW2Z1bmN0aW9uIChkYXRhLCBoZWFkZXJzKSB7XG4gICAgaWYodXRpbHMuaXNGb3JtRGF0YShkYXRhKSkge1xuICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfVxuICAgIGlmICh1dGlscy5pc0FycmF5QnVmZmVyKGRhdGEpKSB7XG4gICAgICByZXR1cm4gZGF0YTtcbiAgICB9XG4gICAgaWYgKHV0aWxzLmlzQXJyYXlCdWZmZXJWaWV3KGRhdGEpKSB7XG4gICAgICByZXR1cm4gZGF0YS5idWZmZXI7XG4gICAgfVxuICAgIGlmICh1dGlscy5pc09iamVjdChkYXRhKSAmJiAhdXRpbHMuaXNGaWxlKGRhdGEpICYmICF1dGlscy5pc0Jsb2IoZGF0YSkpIHtcbiAgICAgIC8vIFNldCBhcHBsaWNhdGlvbi9qc29uIGlmIG5vIENvbnRlbnQtVHlwZSBoYXMgYmVlbiBzcGVjaWZpZWRcbiAgICAgIGlmICghdXRpbHMuaXNVbmRlZmluZWQoaGVhZGVycykpIHtcbiAgICAgICAgdXRpbHMuZm9yRWFjaChoZWFkZXJzLCBmdW5jdGlvbiAodmFsLCBrZXkpIHtcbiAgICAgICAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgPT09ICdjb250ZW50LXR5cGUnKSB7XG4gICAgICAgICAgICBoZWFkZXJzWydDb250ZW50LVR5cGUnXSA9IHZhbDtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICh1dGlscy5pc1VuZGVmaW5lZChoZWFkZXJzWydDb250ZW50LVR5cGUnXSkpIHtcbiAgICAgICAgICBoZWFkZXJzWydDb250ZW50LVR5cGUnXSA9ICdhcHBsaWNhdGlvbi9qc29uO2NoYXJzZXQ9dXRmLTgnO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoZGF0YSk7XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9XSxcblxuICB0cmFuc2Zvcm1SZXNwb25zZTogW2Z1bmN0aW9uIChkYXRhKSB7XG4gICAgaWYgKHR5cGVvZiBkYXRhID09PSAnc3RyaW5nJykge1xuICAgICAgZGF0YSA9IGRhdGEucmVwbGFjZShQUk9URUNUSU9OX1BSRUZJWCwgJycpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZGF0YSA9IEpTT04ucGFyc2UoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlKSB7IC8qIElnbm9yZSAqLyB9XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9XSxcblxuICBoZWFkZXJzOiB7XG4gICAgY29tbW9uOiB7XG4gICAgICAnQWNjZXB0JzogJ2FwcGxpY2F0aW9uL2pzb24sIHRleHQvcGxhaW4sICovKidcbiAgICB9LFxuICAgIHBhdGNoOiB1dGlscy5tZXJnZShERUZBVUxUX0NPTlRFTlRfVFlQRSksXG4gICAgcG9zdDogdXRpbHMubWVyZ2UoREVGQVVMVF9DT05URU5UX1RZUEUpLFxuICAgIHB1dDogdXRpbHMubWVyZ2UoREVGQVVMVF9DT05URU5UX1RZUEUpXG4gIH0sXG5cbiAgdGltZW91dDogMCxcblxuICB4c3JmQ29va2llTmFtZTogJ1hTUkYtVE9LRU4nLFxuICB4c3JmSGVhZGVyTmFtZTogJ1gtWFNSRi1UT0tFTidcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vLi4vdXRpbHMnKTtcblxuZnVuY3Rpb24gZW5jb2RlKHZhbCkge1xuICByZXR1cm4gZW5jb2RlVVJJQ29tcG9uZW50KHZhbCkuXG4gICAgcmVwbGFjZSgvJTQwL2dpLCAnQCcpLlxuICAgIHJlcGxhY2UoLyUzQS9naSwgJzonKS5cbiAgICByZXBsYWNlKC8lMjQvZywgJyQnKS5cbiAgICByZXBsYWNlKC8lMkMvZ2ksICcsJykuXG4gICAgcmVwbGFjZSgvJTIwL2csICcrJykuXG4gICAgcmVwbGFjZSgvJTVCL2dpLCAnWycpLlxuICAgIHJlcGxhY2UoLyU1RC9naSwgJ10nKTtcbn1cblxuLyoqXG4gKiBCdWlsZCBhIFVSTCBieSBhcHBlbmRpbmcgcGFyYW1zIHRvIHRoZSBlbmRcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gdXJsIFRoZSBiYXNlIG9mIHRoZSB1cmwgKGUuZy4sIGh0dHA6Ly93d3cuZ29vZ2xlLmNvbSlcbiAqIEBwYXJhbSB7b2JqZWN0fSBbcGFyYW1zXSBUaGUgcGFyYW1zIHRvIGJlIGFwcGVuZGVkXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgZm9ybWF0dGVkIHVybFxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGJ1aWxkVXJsKHVybCwgcGFyYW1zKSB7XG4gIGlmICghcGFyYW1zKSB7XG4gICAgcmV0dXJuIHVybDtcbiAgfVxuXG4gIHZhciBwYXJ0cyA9IFtdO1xuXG4gIHV0aWxzLmZvckVhY2gocGFyYW1zLCBmdW5jdGlvbiAodmFsLCBrZXkpIHtcbiAgICBpZiAodmFsID09PSBudWxsIHx8IHR5cGVvZiB2YWwgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHV0aWxzLmlzQXJyYXkodmFsKSkge1xuICAgICAga2V5ID0ga2V5ICsgJ1tdJztcbiAgICB9XG5cbiAgICBpZiAoIXV0aWxzLmlzQXJyYXkodmFsKSkge1xuICAgICAgdmFsID0gW3ZhbF07XG4gICAgfVxuXG4gICAgdXRpbHMuZm9yRWFjaCh2YWwsIGZ1bmN0aW9uICh2KSB7XG4gICAgICBpZiAodXRpbHMuaXNEYXRlKHYpKSB7XG4gICAgICAgIHYgPSB2LnRvSVNPU3RyaW5nKCk7XG4gICAgICB9XG4gICAgICBlbHNlIGlmICh1dGlscy5pc09iamVjdCh2KSkge1xuICAgICAgICB2ID0gSlNPTi5zdHJpbmdpZnkodik7XG4gICAgICB9XG4gICAgICBwYXJ0cy5wdXNoKGVuY29kZShrZXkpICsgJz0nICsgZW5jb2RlKHYpKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgaWYgKHBhcnRzLmxlbmd0aCA+IDApIHtcbiAgICB1cmwgKz0gKHVybC5pbmRleE9mKCc/JykgPT09IC0xID8gJz8nIDogJyYnKSArIHBhcnRzLmpvaW4oJyYnKTtcbiAgfVxuXG4gIHJldHVybiB1cmw7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIFdBUk5JTkc6XG4gKiAgVGhpcyBmaWxlIG1ha2VzIHJlZmVyZW5jZXMgdG8gb2JqZWN0cyB0aGF0IGFyZW4ndCBzYWZlIGluIGFsbCBlbnZpcm9ubWVudHMuXG4gKiAgUGxlYXNlIHNlZSBsaWIvdXRpbHMuaXNTdGFuZGFyZEJyb3dzZXJFbnYgYmVmb3JlIGluY2x1ZGluZyB0aGlzIGZpbGUuXG4gKi9cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi8uLi91dGlscycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgd3JpdGU6IGZ1bmN0aW9uIHdyaXRlKG5hbWUsIHZhbHVlLCBleHBpcmVzLCBwYXRoLCBkb21haW4sIHNlY3VyZSkge1xuICAgIHZhciBjb29raWUgPSBbXTtcbiAgICBjb29raWUucHVzaChuYW1lICsgJz0nICsgZW5jb2RlVVJJQ29tcG9uZW50KHZhbHVlKSk7XG5cbiAgICBpZiAodXRpbHMuaXNOdW1iZXIoZXhwaXJlcykpIHtcbiAgICAgIGNvb2tpZS5wdXNoKCdleHBpcmVzPScgKyBuZXcgRGF0ZShleHBpcmVzKS50b0dNVFN0cmluZygpKTtcbiAgICB9XG5cbiAgICBpZiAodXRpbHMuaXNTdHJpbmcocGF0aCkpIHtcbiAgICAgIGNvb2tpZS5wdXNoKCdwYXRoPScgKyBwYXRoKTtcbiAgICB9XG5cbiAgICBpZiAodXRpbHMuaXNTdHJpbmcoZG9tYWluKSkge1xuICAgICAgY29va2llLnB1c2goJ2RvbWFpbj0nICsgZG9tYWluKTtcbiAgICB9XG5cbiAgICBpZiAoc2VjdXJlID09PSB0cnVlKSB7XG4gICAgICBjb29raWUucHVzaCgnc2VjdXJlJyk7XG4gICAgfVxuXG4gICAgZG9jdW1lbnQuY29va2llID0gY29va2llLmpvaW4oJzsgJyk7XG4gIH0sXG5cbiAgcmVhZDogZnVuY3Rpb24gcmVhZChuYW1lKSB7XG4gICAgdmFyIG1hdGNoID0gZG9jdW1lbnQuY29va2llLm1hdGNoKG5ldyBSZWdFeHAoJyhefDtcXFxccyopKCcgKyBuYW1lICsgJyk9KFteO10qKScpKTtcbiAgICByZXR1cm4gKG1hdGNoID8gZGVjb2RlVVJJQ29tcG9uZW50KG1hdGNoWzNdKSA6IG51bGwpO1xuICB9LFxuXG4gIHJlbW92ZTogZnVuY3Rpb24gcmVtb3ZlKG5hbWUpIHtcbiAgICB0aGlzLndyaXRlKG5hbWUsICcnLCBEYXRlLm5vdygpIC0gODY0MDAwMDApO1xuICB9XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLy4uL3V0aWxzJyk7XG5cbi8qKlxuICogUGFyc2UgaGVhZGVycyBpbnRvIGFuIG9iamVjdFxuICpcbiAqIGBgYFxuICogRGF0ZTogV2VkLCAyNyBBdWcgMjAxNCAwODo1ODo0OSBHTVRcbiAqIENvbnRlbnQtVHlwZTogYXBwbGljYXRpb24vanNvblxuICogQ29ubmVjdGlvbjoga2VlcC1hbGl2ZVxuICogVHJhbnNmZXItRW5jb2Rpbmc6IGNodW5rZWRcbiAqIGBgYFxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBoZWFkZXJzIEhlYWRlcnMgbmVlZGluZyB0byBiZSBwYXJzZWRcbiAqIEByZXR1cm5zIHtPYmplY3R9IEhlYWRlcnMgcGFyc2VkIGludG8gYW4gb2JqZWN0XG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gcGFyc2VIZWFkZXJzKGhlYWRlcnMpIHtcbiAgdmFyIHBhcnNlZCA9IHt9LCBrZXksIHZhbCwgaTtcblxuICBpZiAoIWhlYWRlcnMpIHsgcmV0dXJuIHBhcnNlZDsgfVxuXG4gIHV0aWxzLmZvckVhY2goaGVhZGVycy5zcGxpdCgnXFxuJyksIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICBpID0gbGluZS5pbmRleE9mKCc6Jyk7XG4gICAga2V5ID0gdXRpbHMudHJpbShsaW5lLnN1YnN0cigwLCBpKSkudG9Mb3dlckNhc2UoKTtcbiAgICB2YWwgPSB1dGlscy50cmltKGxpbmUuc3Vic3RyKGkgKyAxKSk7XG5cbiAgICBpZiAoa2V5KSB7XG4gICAgICBwYXJzZWRba2V5XSA9IHBhcnNlZFtrZXldID8gcGFyc2VkW2tleV0gKyAnLCAnICsgdmFsIDogdmFsO1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIHBhcnNlZDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbi8qKlxuICogU3ludGFjdGljIHN1Z2FyIGZvciBpbnZva2luZyBhIGZ1bmN0aW9uIGFuZCBleHBhbmRpbmcgYW4gYXJyYXkgZm9yIGFyZ3VtZW50cy5cbiAqXG4gKiBDb21tb24gdXNlIGNhc2Ugd291bGQgYmUgdG8gdXNlIGBGdW5jdGlvbi5wcm90b3R5cGUuYXBwbHlgLlxuICpcbiAqICBgYGBqc1xuICogIGZ1bmN0aW9uIGYoeCwgeSwgeikge31cbiAqICB2YXIgYXJncyA9IFsxLCAyLCAzXTtcbiAqICBmLmFwcGx5KG51bGwsIGFyZ3MpO1xuICogIGBgYFxuICpcbiAqIFdpdGggYHNwcmVhZGAgdGhpcyBleGFtcGxlIGNhbiBiZSByZS13cml0dGVuLlxuICpcbiAqICBgYGBqc1xuICogIHNwcmVhZChmdW5jdGlvbih4LCB5LCB6KSB7fSkoWzEsIDIsIDNdKTtcbiAqICBgYGBcbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFja1xuICogQHJldHVybnMge0Z1bmN0aW9ufVxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIHNwcmVhZChjYWxsYmFjaykge1xuICByZXR1cm4gZnVuY3Rpb24gKGFycikge1xuICAgIHJldHVybiBjYWxsYmFjay5hcHBseShudWxsLCBhcnIpO1xuICB9O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi8uLi91dGlscycpO1xuXG4vKipcbiAqIFRyYW5zZm9ybSB0aGUgZGF0YSBmb3IgYSByZXF1ZXN0IG9yIGEgcmVzcG9uc2VcbiAqXG4gKiBAcGFyYW0ge09iamVjdHxTdHJpbmd9IGRhdGEgVGhlIGRhdGEgdG8gYmUgdHJhbnNmb3JtZWRcbiAqIEBwYXJhbSB7QXJyYXl9IGhlYWRlcnMgVGhlIGhlYWRlcnMgZm9yIHRoZSByZXF1ZXN0IG9yIHJlc3BvbnNlXG4gKiBAcGFyYW0ge0FycmF5fEZ1bmN0aW9ufSBmbnMgQSBzaW5nbGUgZnVuY3Rpb24gb3IgQXJyYXkgb2YgZnVuY3Rpb25zXG4gKiBAcmV0dXJucyB7Kn0gVGhlIHJlc3VsdGluZyB0cmFuc2Zvcm1lZCBkYXRhXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gdHJhbnNmb3JtRGF0YShkYXRhLCBoZWFkZXJzLCBmbnMpIHtcbiAgdXRpbHMuZm9yRWFjaChmbnMsIGZ1bmN0aW9uIChmbikge1xuICAgIGRhdGEgPSBmbihkYXRhLCBoZWFkZXJzKTtcbiAgfSk7XG5cbiAgcmV0dXJuIGRhdGE7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIFdBUk5JTkc6XG4gKiAgVGhpcyBmaWxlIG1ha2VzIHJlZmVyZW5jZXMgdG8gb2JqZWN0cyB0aGF0IGFyZW4ndCBzYWZlIGluIGFsbCBlbnZpcm9ubWVudHMuXG4gKiAgUGxlYXNlIHNlZSBsaWIvdXRpbHMuaXNTdGFuZGFyZEJyb3dzZXJFbnYgYmVmb3JlIGluY2x1ZGluZyB0aGlzIGZpbGUuXG4gKi9cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi8uLi91dGlscycpO1xudmFyIG1zaWUgPSAvKG1zaWV8dHJpZGVudCkvaS50ZXN0KG5hdmlnYXRvci51c2VyQWdlbnQpO1xudmFyIHVybFBhcnNpbmdOb2RlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xudmFyIG9yaWdpblVybDtcblxuLyoqXG4gKiBQYXJzZSBhIFVSTCB0byBkaXNjb3ZlciBpdCdzIGNvbXBvbmVudHNcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsIFRoZSBVUkwgdG8gYmUgcGFyc2VkXG4gKiBAcmV0dXJucyB7T2JqZWN0fVxuICovXG5mdW5jdGlvbiB1cmxSZXNvbHZlKHVybCkge1xuICB2YXIgaHJlZiA9IHVybDtcblxuICBpZiAobXNpZSkge1xuICAgIC8vIElFIG5lZWRzIGF0dHJpYnV0ZSBzZXQgdHdpY2UgdG8gbm9ybWFsaXplIHByb3BlcnRpZXNcbiAgICB1cmxQYXJzaW5nTm9kZS5zZXRBdHRyaWJ1dGUoJ2hyZWYnLCBocmVmKTtcbiAgICBocmVmID0gdXJsUGFyc2luZ05vZGUuaHJlZjtcbiAgfVxuXG4gIHVybFBhcnNpbmdOb2RlLnNldEF0dHJpYnV0ZSgnaHJlZicsIGhyZWYpO1xuXG4gIC8vIHVybFBhcnNpbmdOb2RlIHByb3ZpZGVzIHRoZSBVcmxVdGlscyBpbnRlcmZhY2UgLSBodHRwOi8vdXJsLnNwZWMud2hhdHdnLm9yZy8jdXJsdXRpbHNcbiAgcmV0dXJuIHtcbiAgICBocmVmOiB1cmxQYXJzaW5nTm9kZS5ocmVmLFxuICAgIHByb3RvY29sOiB1cmxQYXJzaW5nTm9kZS5wcm90b2NvbCA/IHVybFBhcnNpbmdOb2RlLnByb3RvY29sLnJlcGxhY2UoLzokLywgJycpIDogJycsXG4gICAgaG9zdDogdXJsUGFyc2luZ05vZGUuaG9zdCxcbiAgICBzZWFyY2g6IHVybFBhcnNpbmdOb2RlLnNlYXJjaCA/IHVybFBhcnNpbmdOb2RlLnNlYXJjaC5yZXBsYWNlKC9eXFw/LywgJycpIDogJycsXG4gICAgaGFzaDogdXJsUGFyc2luZ05vZGUuaGFzaCA/IHVybFBhcnNpbmdOb2RlLmhhc2gucmVwbGFjZSgvXiMvLCAnJykgOiAnJyxcbiAgICBob3N0bmFtZTogdXJsUGFyc2luZ05vZGUuaG9zdG5hbWUsXG4gICAgcG9ydDogdXJsUGFyc2luZ05vZGUucG9ydCxcbiAgICBwYXRobmFtZTogKHVybFBhcnNpbmdOb2RlLnBhdGhuYW1lLmNoYXJBdCgwKSA9PT0gJy8nKSA/XG4gICAgICAgICAgICAgIHVybFBhcnNpbmdOb2RlLnBhdGhuYW1lIDpcbiAgICAgICAgICAgICAgJy8nICsgdXJsUGFyc2luZ05vZGUucGF0aG5hbWVcbiAgfTtcbn1cblxub3JpZ2luVXJsID0gdXJsUmVzb2x2ZSh3aW5kb3cubG9jYXRpb24uaHJlZik7XG5cbi8qKlxuICogRGV0ZXJtaW5lIGlmIGEgVVJMIHNoYXJlcyB0aGUgc2FtZSBvcmlnaW4gYXMgdGhlIGN1cnJlbnQgbG9jYXRpb25cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gcmVxdWVzdFVybCBUaGUgVVJMIHRvIHRlc3RcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIFVSTCBzaGFyZXMgdGhlIHNhbWUgb3JpZ2luLCBvdGhlcndpc2UgZmFsc2VcbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiB1cmxJc1NhbWVPcmlnaW4ocmVxdWVzdFVybCkge1xuICB2YXIgcGFyc2VkID0gKHV0aWxzLmlzU3RyaW5nKHJlcXVlc3RVcmwpKSA/IHVybFJlc29sdmUocmVxdWVzdFVybCkgOiByZXF1ZXN0VXJsO1xuICByZXR1cm4gKHBhcnNlZC5wcm90b2NvbCA9PT0gb3JpZ2luVXJsLnByb3RvY29sICYmXG4gICAgICAgIHBhcnNlZC5ob3N0ID09PSBvcmlnaW5VcmwuaG9zdCk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG4vKmdsb2JhbCB0b1N0cmluZzp0cnVlKi9cblxuLy8gdXRpbHMgaXMgYSBsaWJyYXJ5IG9mIGdlbmVyaWMgaGVscGVyIGZ1bmN0aW9ucyBub24tc3BlY2lmaWMgdG8gYXhpb3NcblxudmFyIHRvU3RyaW5nID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZztcblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhbiBBcnJheVxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSB2YWwgVGhlIHZhbHVlIHRvIHRlc3RcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHZhbHVlIGlzIGFuIEFycmF5LCBvdGhlcndpc2UgZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNBcnJheSh2YWwpIHtcbiAgcmV0dXJuIHRvU3RyaW5nLmNhbGwodmFsKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhbiBBcnJheUJ1ZmZlclxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSB2YWwgVGhlIHZhbHVlIHRvIHRlc3RcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHZhbHVlIGlzIGFuIEFycmF5QnVmZmVyLCBvdGhlcndpc2UgZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNBcnJheUJ1ZmZlcih2YWwpIHtcbiAgcmV0dXJuIHRvU3RyaW5nLmNhbGwodmFsKSA9PT0gJ1tvYmplY3QgQXJyYXlCdWZmZXJdJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhIEZvcm1EYXRhXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IHZhbCBUaGUgdmFsdWUgdG8gdGVzdFxuICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdmFsdWUgaXMgYW4gRm9ybURhdGEsIG90aGVyd2lzZSBmYWxzZVxuICovXG5mdW5jdGlvbiBpc0Zvcm1EYXRhKHZhbCkge1xuICByZXR1cm4gdG9TdHJpbmcuY2FsbCh2YWwpID09PSAnW29iamVjdCBGb3JtRGF0YV0nO1xufVxuXG4vKipcbiAqIERldGVybWluZSBpZiBhIHZhbHVlIGlzIGEgdmlldyBvbiBhbiBBcnJheUJ1ZmZlclxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSB2YWwgVGhlIHZhbHVlIHRvIHRlc3RcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHZhbHVlIGlzIGEgdmlldyBvbiBhbiBBcnJheUJ1ZmZlciwgb3RoZXJ3aXNlIGZhbHNlXG4gKi9cbmZ1bmN0aW9uIGlzQXJyYXlCdWZmZXJWaWV3KHZhbCkge1xuICBpZiAoKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcpICYmIChBcnJheUJ1ZmZlci5pc1ZpZXcpKSB7XG4gICAgcmV0dXJuIEFycmF5QnVmZmVyLmlzVmlldyh2YWwpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiAodmFsKSAmJiAodmFsLmJ1ZmZlcikgJiYgKHZhbC5idWZmZXIgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcik7XG4gIH1cbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhIFN0cmluZ1xuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSB2YWwgVGhlIHZhbHVlIHRvIHRlc3RcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHZhbHVlIGlzIGEgU3RyaW5nLCBvdGhlcndpc2UgZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNTdHJpbmcodmFsKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsID09PSAnc3RyaW5nJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhIE51bWJlclxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSB2YWwgVGhlIHZhbHVlIHRvIHRlc3RcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHZhbHVlIGlzIGEgTnVtYmVyLCBvdGhlcndpc2UgZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNOdW1iZXIodmFsKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsID09PSAnbnVtYmVyJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyB1bmRlZmluZWRcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsIFRoZSB2YWx1ZSB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgdmFsdWUgaXMgdW5kZWZpbmVkLCBvdGhlcndpc2UgZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNVbmRlZmluZWQodmFsKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsID09PSAndW5kZWZpbmVkJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhbiBPYmplY3RcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsIFRoZSB2YWx1ZSB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB2YWx1ZSBpcyBhbiBPYmplY3QsIG90aGVyd2lzZSBmYWxzZVxuICovXG5mdW5jdGlvbiBpc09iamVjdCh2YWwpIHtcbiAgcmV0dXJuIHZhbCAhPT0gbnVsbCAmJiB0eXBlb2YgdmFsID09PSAnb2JqZWN0Jztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhIERhdGVcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsIFRoZSB2YWx1ZSB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB2YWx1ZSBpcyBhIERhdGUsIG90aGVyd2lzZSBmYWxzZVxuICovXG5mdW5jdGlvbiBpc0RhdGUodmFsKSB7XG4gIHJldHVybiB0b1N0cmluZy5jYWxsKHZhbCkgPT09ICdbb2JqZWN0IERhdGVdJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhIEZpbGVcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsIFRoZSB2YWx1ZSB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB2YWx1ZSBpcyBhIEZpbGUsIG90aGVyd2lzZSBmYWxzZVxuICovXG5mdW5jdGlvbiBpc0ZpbGUodmFsKSB7XG4gIHJldHVybiB0b1N0cmluZy5jYWxsKHZhbCkgPT09ICdbb2JqZWN0IEZpbGVdJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhIEJsb2JcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsIFRoZSB2YWx1ZSB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB2YWx1ZSBpcyBhIEJsb2IsIG90aGVyd2lzZSBmYWxzZVxuICovXG5mdW5jdGlvbiBpc0Jsb2IodmFsKSB7XG4gIHJldHVybiB0b1N0cmluZy5jYWxsKHZhbCkgPT09ICdbb2JqZWN0IEJsb2JdJztcbn1cblxuLyoqXG4gKiBUcmltIGV4Y2VzcyB3aGl0ZXNwYWNlIG9mZiB0aGUgYmVnaW5uaW5nIGFuZCBlbmQgb2YgYSBzdHJpbmdcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyIFRoZSBTdHJpbmcgdG8gdHJpbVxuICogQHJldHVybnMge1N0cmluZ30gVGhlIFN0cmluZyBmcmVlZCBvZiBleGNlc3Mgd2hpdGVzcGFjZVxuICovXG5mdW5jdGlvbiB0cmltKHN0cikge1xuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMqLywgJycpLnJlcGxhY2UoL1xccyokLywgJycpO1xufVxuXG4vKipcbiAqIERldGVybWluZSBpZiBhIHZhbHVlIGlzIGFuIEFyZ3VtZW50cyBvYmplY3RcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsIFRoZSB2YWx1ZSB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB2YWx1ZSBpcyBhbiBBcmd1bWVudHMgb2JqZWN0LCBvdGhlcndpc2UgZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNBcmd1bWVudHModmFsKSB7XG4gIHJldHVybiB0b1N0cmluZy5jYWxsKHZhbCkgPT09ICdbb2JqZWN0IEFyZ3VtZW50c10nO1xufVxuXG4vKipcbiAqIERldGVybWluZSBpZiB3ZSdyZSBydW5uaW5nIGluIGEgc3RhbmRhcmQgYnJvd3NlciBlbnZpcm9ubWVudFxuICpcbiAqIFRoaXMgYWxsb3dzIGF4aW9zIHRvIHJ1biBpbiBhIHdlYiB3b3JrZXIsIGFuZCByZWFjdC1uYXRpdmUuXG4gKiBCb3RoIGVudmlyb25tZW50cyBzdXBwb3J0IFhNTEh0dHBSZXF1ZXN0LCBidXQgbm90IGZ1bGx5IHN0YW5kYXJkIGdsb2JhbHMuXG4gKlxuICogd2ViIHdvcmtlcnM6XG4gKiAgdHlwZW9mIHdpbmRvdyAtPiB1bmRlZmluZWRcbiAqICB0eXBlb2YgZG9jdW1lbnQgLT4gdW5kZWZpbmVkXG4gKlxuICogcmVhY3QtbmF0aXZlOlxuICogIHR5cGVvZiBkb2N1bWVudC5jcmVhdGVlbGVtZW50IC0+IHVuZGVmaW5lZFxuICovXG5mdW5jdGlvbiBpc1N0YW5kYXJkQnJvd3NlckVudigpIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJlxuICAgIHR5cGVvZiBkb2N1bWVudCAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICB0eXBlb2YgZG9jdW1lbnQuY3JlYXRlRWxlbWVudCA9PT0gJ2Z1bmN0aW9uJ1xuICApO1xufVxuXG4vKipcbiAqIEl0ZXJhdGUgb3ZlciBhbiBBcnJheSBvciBhbiBPYmplY3QgaW52b2tpbmcgYSBmdW5jdGlvbiBmb3IgZWFjaCBpdGVtLlxuICpcbiAqIElmIGBvYmpgIGlzIGFuIEFycmF5IG9yIGFyZ3VtZW50cyBjYWxsYmFjayB3aWxsIGJlIGNhbGxlZCBwYXNzaW5nXG4gKiB0aGUgdmFsdWUsIGluZGV4LCBhbmQgY29tcGxldGUgYXJyYXkgZm9yIGVhY2ggaXRlbS5cbiAqXG4gKiBJZiAnb2JqJyBpcyBhbiBPYmplY3QgY2FsbGJhY2sgd2lsbCBiZSBjYWxsZWQgcGFzc2luZ1xuICogdGhlIHZhbHVlLCBrZXksIGFuZCBjb21wbGV0ZSBvYmplY3QgZm9yIGVhY2ggcHJvcGVydHkuXG4gKlxuICogQHBhcmFtIHtPYmplY3R8QXJyYXl9IG9iaiBUaGUgb2JqZWN0IHRvIGl0ZXJhdGVcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIFRoZSBjYWxsYmFjayB0byBpbnZva2UgZm9yIGVhY2ggaXRlbVxuICovXG5mdW5jdGlvbiBmb3JFYWNoKG9iaiwgZm4pIHtcbiAgLy8gRG9uJ3QgYm90aGVyIGlmIG5vIHZhbHVlIHByb3ZpZGVkXG4gIGlmIChvYmogPT09IG51bGwgfHwgdHlwZW9mIG9iaiA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBDaGVjayBpZiBvYmogaXMgYXJyYXktbGlrZVxuICB2YXIgaXNBcnJheUxpa2UgPSBpc0FycmF5KG9iaikgfHwgaXNBcmd1bWVudHMob2JqKTtcblxuICAvLyBGb3JjZSBhbiBhcnJheSBpZiBub3QgYWxyZWFkeSBzb21ldGhpbmcgaXRlcmFibGVcbiAgaWYgKHR5cGVvZiBvYmogIT09ICdvYmplY3QnICYmICFpc0FycmF5TGlrZSkge1xuICAgIG9iaiA9IFtvYmpdO1xuICB9XG5cbiAgLy8gSXRlcmF0ZSBvdmVyIGFycmF5IHZhbHVlc1xuICBpZiAoaXNBcnJheUxpa2UpIHtcbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IG9iai5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIGZuLmNhbGwobnVsbCwgb2JqW2ldLCBpLCBvYmopO1xuICAgIH1cbiAgfVxuICAvLyBJdGVyYXRlIG92ZXIgb2JqZWN0IGtleXNcbiAgZWxzZSB7XG4gICAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgICAgaWYgKG9iai5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgIGZuLmNhbGwobnVsbCwgb2JqW2tleV0sIGtleSwgb2JqKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBBY2NlcHRzIHZhcmFyZ3MgZXhwZWN0aW5nIGVhY2ggYXJndW1lbnQgdG8gYmUgYW4gb2JqZWN0LCB0aGVuXG4gKiBpbW11dGFibHkgbWVyZ2VzIHRoZSBwcm9wZXJ0aWVzIG9mIGVhY2ggb2JqZWN0IGFuZCByZXR1cm5zIHJlc3VsdC5cbiAqXG4gKiBXaGVuIG11bHRpcGxlIG9iamVjdHMgY29udGFpbiB0aGUgc2FtZSBrZXkgdGhlIGxhdGVyIG9iamVjdCBpblxuICogdGhlIGFyZ3VtZW50cyBsaXN0IHdpbGwgdGFrZSBwcmVjZWRlbmNlLlxuICpcbiAqIEV4YW1wbGU6XG4gKlxuICogYGBganNcbiAqIHZhciByZXN1bHQgPSBtZXJnZSh7Zm9vOiAxMjN9LCB7Zm9vOiA0NTZ9KTtcbiAqIGNvbnNvbGUubG9nKHJlc3VsdC5mb28pOyAvLyBvdXRwdXRzIDQ1NlxuICogYGBgXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9iajEgT2JqZWN0IHRvIG1lcmdlXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBSZXN1bHQgb2YgYWxsIG1lcmdlIHByb3BlcnRpZXNcbiAqL1xuZnVuY3Rpb24gbWVyZ2UoLypvYmoxLCBvYmoyLCBvYmozLCAuLi4qLykge1xuICB2YXIgcmVzdWx0ID0ge307XG4gIGZvckVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAob2JqKSB7XG4gICAgZm9yRWFjaChvYmosIGZ1bmN0aW9uICh2YWwsIGtleSkge1xuICAgICAgcmVzdWx0W2tleV0gPSB2YWw7XG4gICAgfSk7XG4gIH0pO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgaXNBcnJheTogaXNBcnJheSxcbiAgaXNBcnJheUJ1ZmZlcjogaXNBcnJheUJ1ZmZlcixcbiAgaXNGb3JtRGF0YTogaXNGb3JtRGF0YSxcbiAgaXNBcnJheUJ1ZmZlclZpZXc6IGlzQXJyYXlCdWZmZXJWaWV3LFxuICBpc1N0cmluZzogaXNTdHJpbmcsXG4gIGlzTnVtYmVyOiBpc051bWJlcixcbiAgaXNPYmplY3Q6IGlzT2JqZWN0LFxuICBpc1VuZGVmaW5lZDogaXNVbmRlZmluZWQsXG4gIGlzRGF0ZTogaXNEYXRlLFxuICBpc0ZpbGU6IGlzRmlsZSxcbiAgaXNCbG9iOiBpc0Jsb2IsXG4gIGlzU3RhbmRhcmRCcm93c2VyRW52OiBpc1N0YW5kYXJkQnJvd3NlckVudixcbiAgZm9yRWFjaDogZm9yRWFjaCxcbiAgbWVyZ2U6IG1lcmdlLFxuICB0cmltOiB0cmltXG59O1xuIiwiLyohXG4gKiBUaGUgYnVmZmVyIG1vZHVsZSBmcm9tIG5vZGUuanMsIGZvciB0aGUgYnJvd3Nlci5cbiAqXG4gKiBAYXV0aG9yICAgRmVyb3NzIEFib3VraGFkaWplaCA8ZmVyb3NzQGZlcm9zcy5vcmc+IDxodHRwOi8vZmVyb3NzLm9yZz5cbiAqIEBsaWNlbnNlICBNSVRcbiAqL1xuLyogZXNsaW50LWRpc2FibGUgbm8tcHJvdG8gKi9cblxudmFyIGJhc2U2NCA9IHJlcXVpcmUoJ2Jhc2U2NC1qcycpXG52YXIgaWVlZTc1NCA9IHJlcXVpcmUoJ2llZWU3NTQnKVxudmFyIGlzQXJyYXkgPSByZXF1aXJlKCdpcy1hcnJheScpXG5cbmV4cG9ydHMuQnVmZmVyID0gQnVmZmVyXG5leHBvcnRzLlNsb3dCdWZmZXIgPSBTbG93QnVmZmVyXG5leHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTID0gNTBcbkJ1ZmZlci5wb29sU2l6ZSA9IDgxOTIgLy8gbm90IHVzZWQgYnkgdGhpcyBpbXBsZW1lbnRhdGlvblxuXG52YXIgcm9vdFBhcmVudCA9IHt9XG5cbi8qKlxuICogSWYgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYDpcbiAqICAgPT09IHRydWUgICAgVXNlIFVpbnQ4QXJyYXkgaW1wbGVtZW50YXRpb24gKGZhc3Rlc3QpXG4gKiAgID09PSBmYWxzZSAgIFVzZSBPYmplY3QgaW1wbGVtZW50YXRpb24gKG1vc3QgY29tcGF0aWJsZSwgZXZlbiBJRTYpXG4gKlxuICogQnJvd3NlcnMgdGhhdCBzdXBwb3J0IHR5cGVkIGFycmF5cyBhcmUgSUUgMTArLCBGaXJlZm94IDQrLCBDaHJvbWUgNyssIFNhZmFyaSA1LjErLFxuICogT3BlcmEgMTEuNissIGlPUyA0LjIrLlxuICpcbiAqIER1ZSB0byB2YXJpb3VzIGJyb3dzZXIgYnVncywgc29tZXRpbWVzIHRoZSBPYmplY3QgaW1wbGVtZW50YXRpb24gd2lsbCBiZSB1c2VkIGV2ZW5cbiAqIHdoZW4gdGhlIGJyb3dzZXIgc3VwcG9ydHMgdHlwZWQgYXJyYXlzLlxuICpcbiAqIE5vdGU6XG4gKlxuICogICAtIEZpcmVmb3ggNC0yOSBsYWNrcyBzdXBwb3J0IGZvciBhZGRpbmcgbmV3IHByb3BlcnRpZXMgdG8gYFVpbnQ4QXJyYXlgIGluc3RhbmNlcyxcbiAqICAgICBTZWU6IGh0dHBzOi8vYnVnemlsbGEubW96aWxsYS5vcmcvc2hvd19idWcuY2dpP2lkPTY5NTQzOC5cbiAqXG4gKiAgIC0gU2FmYXJpIDUtNyBsYWNrcyBzdXBwb3J0IGZvciBjaGFuZ2luZyB0aGUgYE9iamVjdC5wcm90b3R5cGUuY29uc3RydWN0b3JgIHByb3BlcnR5XG4gKiAgICAgb24gb2JqZWN0cy5cbiAqXG4gKiAgIC0gQ2hyb21lIDktMTAgaXMgbWlzc2luZyB0aGUgYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbi5cbiAqXG4gKiAgIC0gSUUxMCBoYXMgYSBicm9rZW4gYFR5cGVkQXJyYXkucHJvdG90eXBlLnN1YmFycmF5YCBmdW5jdGlvbiB3aGljaCByZXR1cm5zIGFycmF5cyBvZlxuICogICAgIGluY29ycmVjdCBsZW5ndGggaW4gc29tZSBzaXR1YXRpb25zLlxuXG4gKiBXZSBkZXRlY3QgdGhlc2UgYnVnZ3kgYnJvd3NlcnMgYW5kIHNldCBgQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRgIHRvIGBmYWxzZWAgc28gdGhleVxuICogZ2V0IHRoZSBPYmplY3QgaW1wbGVtZW50YXRpb24sIHdoaWNoIGlzIHNsb3dlciBidXQgYmVoYXZlcyBjb3JyZWN0bHkuXG4gKi9cbkJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUID0gZ2xvYmFsLlRZUEVEX0FSUkFZX1NVUFBPUlQgIT09IHVuZGVmaW5lZFxuICA/IGdsb2JhbC5UWVBFRF9BUlJBWV9TVVBQT1JUXG4gIDogKGZ1bmN0aW9uICgpIHtcbiAgICAgIGZ1bmN0aW9uIEJhciAoKSB7fVxuICAgICAgdHJ5IHtcbiAgICAgICAgdmFyIGFyciA9IG5ldyBVaW50OEFycmF5KDEpXG4gICAgICAgIGFyci5mb28gPSBmdW5jdGlvbiAoKSB7IHJldHVybiA0MiB9XG4gICAgICAgIGFyci5jb25zdHJ1Y3RvciA9IEJhclxuICAgICAgICByZXR1cm4gYXJyLmZvbygpID09PSA0MiAmJiAvLyB0eXBlZCBhcnJheSBpbnN0YW5jZXMgY2FuIGJlIGF1Z21lbnRlZFxuICAgICAgICAgICAgYXJyLmNvbnN0cnVjdG9yID09PSBCYXIgJiYgLy8gY29uc3RydWN0b3IgY2FuIGJlIHNldFxuICAgICAgICAgICAgdHlwZW9mIGFyci5zdWJhcnJheSA9PT0gJ2Z1bmN0aW9uJyAmJiAvLyBjaHJvbWUgOS0xMCBsYWNrIGBzdWJhcnJheWBcbiAgICAgICAgICAgIGFyci5zdWJhcnJheSgxLCAxKS5ieXRlTGVuZ3RoID09PSAwIC8vIGllMTAgaGFzIGJyb2tlbiBgc3ViYXJyYXlgXG4gICAgICB9IGNhdGNoIChlKSB7XG4gICAgICAgIHJldHVybiBmYWxzZVxuICAgICAgfVxuICAgIH0pKClcblxuZnVuY3Rpb24ga01heExlbmd0aCAoKSB7XG4gIHJldHVybiBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVFxuICAgID8gMHg3ZmZmZmZmZlxuICAgIDogMHgzZmZmZmZmZlxufVxuXG4vKipcbiAqIENsYXNzOiBCdWZmZXJcbiAqID09PT09PT09PT09PT1cbiAqXG4gKiBUaGUgQnVmZmVyIGNvbnN0cnVjdG9yIHJldHVybnMgaW5zdGFuY2VzIG9mIGBVaW50OEFycmF5YCB0aGF0IGFyZSBhdWdtZW50ZWRcbiAqIHdpdGggZnVuY3Rpb24gcHJvcGVydGllcyBmb3IgYWxsIHRoZSBub2RlIGBCdWZmZXJgIEFQSSBmdW5jdGlvbnMuIFdlIHVzZVxuICogYFVpbnQ4QXJyYXlgIHNvIHRoYXQgc3F1YXJlIGJyYWNrZXQgbm90YXRpb24gd29ya3MgYXMgZXhwZWN0ZWQgLS0gaXQgcmV0dXJuc1xuICogYSBzaW5nbGUgb2N0ZXQuXG4gKlxuICogQnkgYXVnbWVudGluZyB0aGUgaW5zdGFuY2VzLCB3ZSBjYW4gYXZvaWQgbW9kaWZ5aW5nIHRoZSBgVWludDhBcnJheWBcbiAqIHByb3RvdHlwZS5cbiAqL1xuZnVuY3Rpb24gQnVmZmVyIChhcmcpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIEJ1ZmZlcikpIHtcbiAgICAvLyBBdm9pZCBnb2luZyB0aHJvdWdoIGFuIEFyZ3VtZW50c0FkYXB0b3JUcmFtcG9saW5lIGluIHRoZSBjb21tb24gY2FzZS5cbiAgICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDEpIHJldHVybiBuZXcgQnVmZmVyKGFyZywgYXJndW1lbnRzWzFdKVxuICAgIHJldHVybiBuZXcgQnVmZmVyKGFyZylcbiAgfVxuXG4gIHRoaXMubGVuZ3RoID0gMFxuICB0aGlzLnBhcmVudCA9IHVuZGVmaW5lZFxuXG4gIC8vIENvbW1vbiBjYXNlLlxuICBpZiAodHlwZW9mIGFyZyA9PT0gJ251bWJlcicpIHtcbiAgICByZXR1cm4gZnJvbU51bWJlcih0aGlzLCBhcmcpXG4gIH1cblxuICAvLyBTbGlnaHRseSBsZXNzIGNvbW1vbiBjYXNlLlxuICBpZiAodHlwZW9mIGFyZyA9PT0gJ3N0cmluZycpIHtcbiAgICByZXR1cm4gZnJvbVN0cmluZyh0aGlzLCBhcmcsIGFyZ3VtZW50cy5sZW5ndGggPiAxID8gYXJndW1lbnRzWzFdIDogJ3V0ZjgnKVxuICB9XG5cbiAgLy8gVW51c3VhbC5cbiAgcmV0dXJuIGZyb21PYmplY3QodGhpcywgYXJnKVxufVxuXG5mdW5jdGlvbiBmcm9tTnVtYmVyICh0aGF0LCBsZW5ndGgpIHtcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aCA8IDAgPyAwIDogY2hlY2tlZChsZW5ndGgpIHwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIHRoYXRbaV0gPSAwXG4gICAgfVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21TdHJpbmcgKHRoYXQsIHN0cmluZywgZW5jb2RpbmcpIHtcbiAgaWYgKHR5cGVvZiBlbmNvZGluZyAhPT0gJ3N0cmluZycgfHwgZW5jb2RpbmcgPT09ICcnKSBlbmNvZGluZyA9ICd1dGY4J1xuXG4gIC8vIEFzc3VtcHRpb246IGJ5dGVMZW5ndGgoKSByZXR1cm4gdmFsdWUgaXMgYWx3YXlzIDwga01heExlbmd0aC5cbiAgdmFyIGxlbmd0aCA9IGJ5dGVMZW5ndGgoc3RyaW5nLCBlbmNvZGluZykgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG5cbiAgdGhhdC53cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tT2JqZWN0ICh0aGF0LCBvYmplY3QpIHtcbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcihvYmplY3QpKSByZXR1cm4gZnJvbUJ1ZmZlcih0aGF0LCBvYmplY3QpXG5cbiAgaWYgKGlzQXJyYXkob2JqZWN0KSkgcmV0dXJuIGZyb21BcnJheSh0aGF0LCBvYmplY3QpXG5cbiAgaWYgKG9iamVjdCA9PSBudWxsKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignbXVzdCBzdGFydCB3aXRoIG51bWJlciwgYnVmZmVyLCBhcnJheSBvciBzdHJpbmcnKVxuICB9XG5cbiAgaWYgKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAob2JqZWN0LmJ1ZmZlciBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB7XG4gICAgICByZXR1cm4gZnJvbVR5cGVkQXJyYXkodGhhdCwgb2JqZWN0KVxuICAgIH1cbiAgICBpZiAob2JqZWN0IGluc3RhbmNlb2YgQXJyYXlCdWZmZXIpIHtcbiAgICAgIHJldHVybiBmcm9tQXJyYXlCdWZmZXIodGhhdCwgb2JqZWN0KVxuICAgIH1cbiAgfVxuXG4gIGlmIChvYmplY3QubGVuZ3RoKSByZXR1cm4gZnJvbUFycmF5TGlrZSh0aGF0LCBvYmplY3QpXG5cbiAgcmV0dXJuIGZyb21Kc29uT2JqZWN0KHRoYXQsIG9iamVjdClcbn1cblxuZnVuY3Rpb24gZnJvbUJ1ZmZlciAodGhhdCwgYnVmZmVyKSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGJ1ZmZlci5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBidWZmZXIuY29weSh0aGF0LCAwLCAwLCBsZW5ndGgpXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheSAodGhhdCwgYXJyYXkpIHtcbiAgdmFyIGxlbmd0aCA9IGNoZWNrZWQoYXJyYXkubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbi8vIER1cGxpY2F0ZSBvZiBmcm9tQXJyYXkoKSB0byBrZWVwIGZyb21BcnJheSgpIG1vbm9tb3JwaGljLlxuZnVuY3Rpb24gZnJvbVR5cGVkQXJyYXkgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIC8vIFRydW5jYXRpbmcgdGhlIGVsZW1lbnRzIGlzIHByb2JhYmx5IG5vdCB3aGF0IHBlb3BsZSBleHBlY3QgZnJvbSB0eXBlZFxuICAvLyBhcnJheXMgd2l0aCBCWVRFU19QRVJfRUxFTUVOVCA+IDEgYnV0IGl0J3MgY29tcGF0aWJsZSB3aXRoIHRoZSBiZWhhdmlvclxuICAvLyBvZiB0aGUgb2xkIEJ1ZmZlciBjb25zdHJ1Y3Rvci5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheUJ1ZmZlciAodGhhdCwgYXJyYXkpIHtcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UsIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgYXJyYXkuYnl0ZUxlbmd0aFxuICAgIHRoYXQgPSBCdWZmZXIuX2F1Z21lbnQobmV3IFVpbnQ4QXJyYXkoYXJyYXkpKVxuICB9IGVsc2Uge1xuICAgIC8vIEZhbGxiYWNrOiBSZXR1cm4gYW4gb2JqZWN0IGluc3RhbmNlIG9mIHRoZSBCdWZmZXIgY2xhc3NcbiAgICB0aGF0ID0gZnJvbVR5cGVkQXJyYXkodGhhdCwgbmV3IFVpbnQ4QXJyYXkoYXJyYXkpKVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGZyb21BcnJheUxpa2UgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG4vLyBEZXNlcmlhbGl6ZSB7IHR5cGU6ICdCdWZmZXInLCBkYXRhOiBbMSwyLDMsLi4uXSB9IGludG8gYSBCdWZmZXIgb2JqZWN0LlxuLy8gUmV0dXJucyBhIHplcm8tbGVuZ3RoIGJ1ZmZlciBmb3IgaW5wdXRzIHRoYXQgZG9uJ3QgY29uZm9ybSB0byB0aGUgc3BlYy5cbmZ1bmN0aW9uIGZyb21Kc29uT2JqZWN0ICh0aGF0LCBvYmplY3QpIHtcbiAgdmFyIGFycmF5XG4gIHZhciBsZW5ndGggPSAwXG5cbiAgaWYgKG9iamVjdC50eXBlID09PSAnQnVmZmVyJyAmJiBpc0FycmF5KG9iamVjdC5kYXRhKSkge1xuICAgIGFycmF5ID0gb2JqZWN0LmRhdGFcbiAgICBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIH1cbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gIEJ1ZmZlci5wcm90b3R5cGUuX19wcm90b19fID0gVWludDhBcnJheS5wcm90b3R5cGVcbiAgQnVmZmVyLl9fcHJvdG9fXyA9IFVpbnQ4QXJyYXlcbn1cblxuZnVuY3Rpb24gYWxsb2NhdGUgKHRoYXQsIGxlbmd0aCkge1xuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAvLyBSZXR1cm4gYW4gYXVnbWVudGVkIGBVaW50OEFycmF5YCBpbnN0YW5jZSwgZm9yIGJlc3QgcGVyZm9ybWFuY2VcbiAgICB0aGF0ID0gQnVmZmVyLl9hdWdtZW50KG5ldyBVaW50OEFycmF5KGxlbmd0aCkpXG4gICAgdGhhdC5fX3Byb3RvX18gPSBCdWZmZXIucHJvdG90eXBlXG4gIH0gZWxzZSB7XG4gICAgLy8gRmFsbGJhY2s6IFJldHVybiBhbiBvYmplY3QgaW5zdGFuY2Ugb2YgdGhlIEJ1ZmZlciBjbGFzc1xuICAgIHRoYXQubGVuZ3RoID0gbGVuZ3RoXG4gICAgdGhhdC5faXNCdWZmZXIgPSB0cnVlXG4gIH1cblxuICB2YXIgZnJvbVBvb2wgPSBsZW5ndGggIT09IDAgJiYgbGVuZ3RoIDw9IEJ1ZmZlci5wb29sU2l6ZSA+Pj4gMVxuICBpZiAoZnJvbVBvb2wpIHRoYXQucGFyZW50ID0gcm9vdFBhcmVudFxuXG4gIHJldHVybiB0aGF0XG59XG5cbmZ1bmN0aW9uIGNoZWNrZWQgKGxlbmd0aCkge1xuICAvLyBOb3RlOiBjYW5ub3QgdXNlIGBsZW5ndGggPCBrTWF4TGVuZ3RoYCBoZXJlIGJlY2F1c2UgdGhhdCBmYWlscyB3aGVuXG4gIC8vIGxlbmd0aCBpcyBOYU4gKHdoaWNoIGlzIG90aGVyd2lzZSBjb2VyY2VkIHRvIHplcm8uKVxuICBpZiAobGVuZ3RoID49IGtNYXhMZW5ndGgoKSkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCdBdHRlbXB0IHRvIGFsbG9jYXRlIEJ1ZmZlciBsYXJnZXIgdGhhbiBtYXhpbXVtICcgK1xuICAgICAgICAgICAgICAgICAgICAgICAgICdzaXplOiAweCcgKyBrTWF4TGVuZ3RoKCkudG9TdHJpbmcoMTYpICsgJyBieXRlcycpXG4gIH1cbiAgcmV0dXJuIGxlbmd0aCB8IDBcbn1cblxuZnVuY3Rpb24gU2xvd0J1ZmZlciAoc3ViamVjdCwgZW5jb2RpbmcpIHtcbiAgaWYgKCEodGhpcyBpbnN0YW5jZW9mIFNsb3dCdWZmZXIpKSByZXR1cm4gbmV3IFNsb3dCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcpXG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIoc3ViamVjdCwgZW5jb2RpbmcpXG4gIGRlbGV0ZSBidWYucGFyZW50XG4gIHJldHVybiBidWZcbn1cblxuQnVmZmVyLmlzQnVmZmVyID0gZnVuY3Rpb24gaXNCdWZmZXIgKGIpIHtcbiAgcmV0dXJuICEhKGIgIT0gbnVsbCAmJiBiLl9pc0J1ZmZlcilcbn1cblxuQnVmZmVyLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChhLCBiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGEpIHx8ICFCdWZmZXIuaXNCdWZmZXIoYikpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudHMgbXVzdCBiZSBCdWZmZXJzJylcbiAgfVxuXG4gIGlmIChhID09PSBiKSByZXR1cm4gMFxuXG4gIHZhciB4ID0gYS5sZW5ndGhcbiAgdmFyIHkgPSBiLmxlbmd0aFxuXG4gIHZhciBpID0gMFxuICB2YXIgbGVuID0gTWF0aC5taW4oeCwgeSlcbiAgd2hpbGUgKGkgPCBsZW4pIHtcbiAgICBpZiAoYVtpXSAhPT0gYltpXSkgYnJlYWtcblxuICAgICsraVxuICB9XG5cbiAgaWYgKGkgIT09IGxlbikge1xuICAgIHggPSBhW2ldXG4gICAgeSA9IGJbaV1cbiAgfVxuXG4gIGlmICh4IDwgeSkgcmV0dXJuIC0xXG4gIGlmICh5IDwgeCkgcmV0dXJuIDFcbiAgcmV0dXJuIDBcbn1cblxuQnVmZmVyLmlzRW5jb2RpbmcgPSBmdW5jdGlvbiBpc0VuY29kaW5nIChlbmNvZGluZykge1xuICBzd2l0Y2ggKFN0cmluZyhlbmNvZGluZykudG9Mb3dlckNhc2UoKSkge1xuICAgIGNhc2UgJ2hleCc6XG4gICAgY2FzZSAndXRmOCc6XG4gICAgY2FzZSAndXRmLTgnOlxuICAgIGNhc2UgJ2FzY2lpJzpcbiAgICBjYXNlICdiaW5hcnknOlxuICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgY2FzZSAncmF3JzpcbiAgICBjYXNlICd1Y3MyJzpcbiAgICBjYXNlICd1Y3MtMic6XG4gICAgY2FzZSAndXRmMTZsZSc6XG4gICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgcmV0dXJuIHRydWVcbiAgICBkZWZhdWx0OlxuICAgICAgcmV0dXJuIGZhbHNlXG4gIH1cbn1cblxuQnVmZmVyLmNvbmNhdCA9IGZ1bmN0aW9uIGNvbmNhdCAobGlzdCwgbGVuZ3RoKSB7XG4gIGlmICghaXNBcnJheShsaXN0KSkgdGhyb3cgbmV3IFR5cGVFcnJvcignbGlzdCBhcmd1bWVudCBtdXN0IGJlIGFuIEFycmF5IG9mIEJ1ZmZlcnMuJylcblxuICBpZiAobGlzdC5sZW5ndGggPT09IDApIHtcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcigwKVxuICB9XG5cbiAgdmFyIGlcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgbGVuZ3RoID0gMFxuICAgIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgICBsZW5ndGggKz0gbGlzdFtpXS5sZW5ndGhcbiAgICB9XG4gIH1cblxuICB2YXIgYnVmID0gbmV3IEJ1ZmZlcihsZW5ndGgpXG4gIHZhciBwb3MgPSAwXG4gIGZvciAoaSA9IDA7IGkgPCBsaXN0Lmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGl0ZW0gPSBsaXN0W2ldXG4gICAgaXRlbS5jb3B5KGJ1ZiwgcG9zKVxuICAgIHBvcyArPSBpdGVtLmxlbmd0aFxuICB9XG4gIHJldHVybiBidWZcbn1cblxuZnVuY3Rpb24gYnl0ZUxlbmd0aCAoc3RyaW5nLCBlbmNvZGluZykge1xuICBpZiAodHlwZW9mIHN0cmluZyAhPT0gJ3N0cmluZycpIHN0cmluZyA9ICcnICsgc3RyaW5nXG5cbiAgdmFyIGxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKGxlbiA9PT0gMCkgcmV0dXJuIDBcblxuICAvLyBVc2UgYSBmb3IgbG9vcCB0byBhdm9pZCByZWN1cnNpb25cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAvLyBEZXByZWNhdGVkXG4gICAgICBjYXNlICdyYXcnOlxuICAgICAgY2FzZSAncmF3cyc6XG4gICAgICAgIHJldHVybiBsZW5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiBsZW4gKiAyXG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gbGVuID4+PiAxXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICByZXR1cm4gYmFzZTY0VG9CeXRlcyhzdHJpbmcpLmxlbmd0aFxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSByZXR1cm4gdXRmOFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGggLy8gYXNzdW1lIHV0ZjhcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cbkJ1ZmZlci5ieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aFxuXG4vLyBwcmUtc2V0IGZvciB2YWx1ZXMgdGhhdCBtYXkgZXhpc3QgaW4gdGhlIGZ1dHVyZVxuQnVmZmVyLnByb3RvdHlwZS5sZW5ndGggPSB1bmRlZmluZWRcbkJ1ZmZlci5wcm90b3R5cGUucGFyZW50ID0gdW5kZWZpbmVkXG5cbmZ1bmN0aW9uIHNsb3dUb1N0cmluZyAoZW5jb2RpbmcsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcblxuICBzdGFydCA9IHN0YXJ0IHwgMFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCB8fCBlbmQgPT09IEluZmluaXR5ID8gdGhpcy5sZW5ndGggOiBlbmQgfCAwXG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcbiAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKGVuZCA8PSBzdGFydCkgcmV0dXJuICcnXG5cbiAgd2hpbGUgKHRydWUpIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdoZXgnOlxuICAgICAgICByZXR1cm4gaGV4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAndXRmOCc6XG4gICAgICBjYXNlICd1dGYtOCc6XG4gICAgICAgIHJldHVybiB1dGY4U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYXNjaWknOlxuICAgICAgICByZXR1cm4gYXNjaWlTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgICByZXR1cm4gYmluYXJ5U2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3VjczInOlxuICAgICAgY2FzZSAndWNzLTInOlxuICAgICAgY2FzZSAndXRmMTZsZSc6XG4gICAgICBjYXNlICd1dGYtMTZsZSc6XG4gICAgICAgIHJldHVybiB1dGYxNmxlU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgaWYgKGxvd2VyZWRDYXNlKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdVbmtub3duIGVuY29kaW5nOiAnICsgZW5jb2RpbmcpXG4gICAgICAgIGVuY29kaW5nID0gKGVuY29kaW5nICsgJycpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUudG9TdHJpbmcgPSBmdW5jdGlvbiB0b1N0cmluZyAoKSB7XG4gIHZhciBsZW5ndGggPSB0aGlzLmxlbmd0aCB8IDBcbiAgaWYgKGxlbmd0aCA9PT0gMCkgcmV0dXJuICcnXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIDAsIGxlbmd0aClcbiAgcmV0dXJuIHNsb3dUb1N0cmluZy5hcHBseSh0aGlzLCBhcmd1bWVudHMpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuZXF1YWxzID0gZnVuY3Rpb24gZXF1YWxzIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiB0cnVlXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKSA9PT0gMFxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluc3BlY3QgPSBmdW5jdGlvbiBpbnNwZWN0ICgpIHtcbiAgdmFyIHN0ciA9ICcnXG4gIHZhciBtYXggPSBleHBvcnRzLklOU1BFQ1RfTUFYX0JZVEVTXG4gIGlmICh0aGlzLmxlbmd0aCA+IDApIHtcbiAgICBzdHIgPSB0aGlzLnRvU3RyaW5nKCdoZXgnLCAwLCBtYXgpLm1hdGNoKC8uezJ9L2cpLmpvaW4oJyAnKVxuICAgIGlmICh0aGlzLmxlbmd0aCA+IG1heCkgc3RyICs9ICcgLi4uICdcbiAgfVxuICByZXR1cm4gJzxCdWZmZXIgJyArIHN0ciArICc+J1xufVxuXG5CdWZmZXIucHJvdG90eXBlLmNvbXBhcmUgPSBmdW5jdGlvbiBjb21wYXJlIChiKSB7XG4gIGlmICghQnVmZmVyLmlzQnVmZmVyKGIpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdBcmd1bWVudCBtdXN0IGJlIGEgQnVmZmVyJylcbiAgaWYgKHRoaXMgPT09IGIpIHJldHVybiAwXG4gIHJldHVybiBCdWZmZXIuY29tcGFyZSh0aGlzLCBiKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmluZGV4T2YgPSBmdW5jdGlvbiBpbmRleE9mICh2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgaWYgKGJ5dGVPZmZzZXQgPiAweDdmZmZmZmZmKSBieXRlT2Zmc2V0ID0gMHg3ZmZmZmZmZlxuICBlbHNlIGlmIChieXRlT2Zmc2V0IDwgLTB4ODAwMDAwMDApIGJ5dGVPZmZzZXQgPSAtMHg4MDAwMDAwMFxuICBieXRlT2Zmc2V0ID4+PSAwXG5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gLTFcbiAgaWYgKGJ5dGVPZmZzZXQgPj0gdGhpcy5sZW5ndGgpIHJldHVybiAtMVxuXG4gIC8vIE5lZ2F0aXZlIG9mZnNldHMgc3RhcnQgZnJvbSB0aGUgZW5kIG9mIHRoZSBidWZmZXJcbiAgaWYgKGJ5dGVPZmZzZXQgPCAwKSBieXRlT2Zmc2V0ID0gTWF0aC5tYXgodGhpcy5sZW5ndGggKyBieXRlT2Zmc2V0LCAwKVxuXG4gIGlmICh0eXBlb2YgdmFsID09PSAnc3RyaW5nJykge1xuICAgIGlmICh2YWwubGVuZ3RoID09PSAwKSByZXR1cm4gLTEgLy8gc3BlY2lhbCBjYXNlOiBsb29raW5nIGZvciBlbXB0eSBzdHJpbmcgYWx3YXlzIGZhaWxzXG4gICAgcmV0dXJuIFN0cmluZy5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAoQnVmZmVyLmlzQnVmZmVyKHZhbCkpIHtcbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIHZhbCwgYnl0ZU9mZnNldClcbiAgfVxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ251bWJlcicpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQgJiYgVWludDhBcnJheS5wcm90b3R5cGUuaW5kZXhPZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgcmV0dXJuIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gICAgfVxuICAgIHJldHVybiBhcnJheUluZGV4T2YodGhpcywgWyB2YWwgXSwgYnl0ZU9mZnNldClcbiAgfVxuXG4gIGZ1bmN0aW9uIGFycmF5SW5kZXhPZiAoYXJyLCB2YWwsIGJ5dGVPZmZzZXQpIHtcbiAgICB2YXIgZm91bmRJbmRleCA9IC0xXG4gICAgZm9yICh2YXIgaSA9IDA7IGJ5dGVPZmZzZXQgKyBpIDwgYXJyLmxlbmd0aDsgaSsrKSB7XG4gICAgICBpZiAoYXJyW2J5dGVPZmZzZXQgKyBpXSA9PT0gdmFsW2ZvdW5kSW5kZXggPT09IC0xID8gMCA6IGkgLSBmb3VuZEluZGV4XSkge1xuICAgICAgICBpZiAoZm91bmRJbmRleCA9PT0gLTEpIGZvdW5kSW5kZXggPSBpXG4gICAgICAgIGlmIChpIC0gZm91bmRJbmRleCArIDEgPT09IHZhbC5sZW5ndGgpIHJldHVybiBieXRlT2Zmc2V0ICsgZm91bmRJbmRleFxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgZm91bmRJbmRleCA9IC0xXG4gICAgICB9XG4gICAgfVxuICAgIHJldHVybiAtMVxuICB9XG5cbiAgdGhyb3cgbmV3IFR5cGVFcnJvcigndmFsIG11c3QgYmUgc3RyaW5nLCBudW1iZXIgb3IgQnVmZmVyJylcbn1cblxuLy8gYGdldGAgaXMgZGVwcmVjYXRlZFxuQnVmZmVyLnByb3RvdHlwZS5nZXQgPSBmdW5jdGlvbiBnZXQgKG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLmdldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMucmVhZFVJbnQ4KG9mZnNldClcbn1cblxuLy8gYHNldGAgaXMgZGVwcmVjYXRlZFxuQnVmZmVyLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiBzZXQgKHYsIG9mZnNldCkge1xuICBjb25zb2xlLmxvZygnLnNldCgpIGlzIGRlcHJlY2F0ZWQuIEFjY2VzcyB1c2luZyBhcnJheSBpbmRleGVzIGluc3RlYWQuJylcbiAgcmV0dXJuIHRoaXMud3JpdGVVSW50OCh2LCBvZmZzZXQpXG59XG5cbmZ1bmN0aW9uIGhleFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgb2Zmc2V0ID0gTnVtYmVyKG9mZnNldCkgfHwgMFxuICB2YXIgcmVtYWluaW5nID0gYnVmLmxlbmd0aCAtIG9mZnNldFxuICBpZiAoIWxlbmd0aCkge1xuICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICB9IGVsc2Uge1xuICAgIGxlbmd0aCA9IE51bWJlcihsZW5ndGgpXG4gICAgaWYgKGxlbmd0aCA+IHJlbWFpbmluZykge1xuICAgICAgbGVuZ3RoID0gcmVtYWluaW5nXG4gICAgfVxuICB9XG5cbiAgLy8gbXVzdCBiZSBhbiBldmVuIG51bWJlciBvZiBkaWdpdHNcbiAgdmFyIHN0ckxlbiA9IHN0cmluZy5sZW5ndGhcbiAgaWYgKHN0ckxlbiAlIDIgIT09IDApIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcblxuICBpZiAobGVuZ3RoID4gc3RyTGVuIC8gMikge1xuICAgIGxlbmd0aCA9IHN0ckxlbiAvIDJcbiAgfVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHBhcnNlZCA9IHBhcnNlSW50KHN0cmluZy5zdWJzdHIoaSAqIDIsIDIpLCAxNilcbiAgICBpZiAoaXNOYU4ocGFyc2VkKSkgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGhleCBzdHJpbmcnKVxuICAgIGJ1ZltvZmZzZXQgKyBpXSA9IHBhcnNlZFxuICB9XG4gIHJldHVybiBpXG59XG5cbmZ1bmN0aW9uIHV0ZjhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKHV0ZjhUb0J5dGVzKHN0cmluZywgYnVmLmxlbmd0aCAtIG9mZnNldCksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGFzY2lpV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcihhc2NpaVRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gYmluYXJ5V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYXNjaWlXcml0ZShidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJhc2U2NFdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIoYmFzZTY0VG9CeXRlcyhzdHJpbmcpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiB1Y3MyV3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcih1dGYxNmxlVG9CeXRlcyhzdHJpbmcsIGJ1Zi5sZW5ndGggLSBvZmZzZXQpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlID0gZnVuY3Rpb24gd3JpdGUgKHN0cmluZywgb2Zmc2V0LCBsZW5ndGgsIGVuY29kaW5nKSB7XG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcpXG4gIGlmIChvZmZzZXQgPT09IHVuZGVmaW5lZCkge1xuICAgIGVuY29kaW5nID0gJ3V0ZjgnXG4gICAgbGVuZ3RoID0gdGhpcy5sZW5ndGhcbiAgICBvZmZzZXQgPSAwXG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcsIGVuY29kaW5nKVxuICB9IGVsc2UgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkICYmIHR5cGVvZiBvZmZzZXQgPT09ICdzdHJpbmcnKSB7XG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBsZW5ndGggPSB0aGlzLmxlbmd0aFxuICAgIG9mZnNldCA9IDBcbiAgLy8gQnVmZmVyI3dyaXRlKHN0cmluZywgb2Zmc2V0WywgbGVuZ3RoXVssIGVuY29kaW5nXSlcbiAgfSBlbHNlIGlmIChpc0Zpbml0ZShvZmZzZXQpKSB7XG4gICAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICAgIGlmIChpc0Zpbml0ZShsZW5ndGgpKSB7XG4gICAgICBsZW5ndGggPSBsZW5ndGggfCAwXG4gICAgICBpZiAoZW5jb2RpbmcgPT09IHVuZGVmaW5lZCkgZW5jb2RpbmcgPSAndXRmOCdcbiAgICB9IGVsc2Uge1xuICAgICAgZW5jb2RpbmcgPSBsZW5ndGhcbiAgICAgIGxlbmd0aCA9IHVuZGVmaW5lZFxuICAgIH1cbiAgLy8gbGVnYWN5IHdyaXRlKHN0cmluZywgZW5jb2RpbmcsIG9mZnNldCwgbGVuZ3RoKSAtIHJlbW92ZSBpbiB2MC4xM1xuICB9IGVsc2Uge1xuICAgIHZhciBzd2FwID0gZW5jb2RpbmdcbiAgICBlbmNvZGluZyA9IG9mZnNldFxuICAgIG9mZnNldCA9IGxlbmd0aCB8IDBcbiAgICBsZW5ndGggPSBzd2FwXG4gIH1cblxuICB2YXIgcmVtYWluaW5nID0gdGhpcy5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKGxlbmd0aCA9PT0gdW5kZWZpbmVkIHx8IGxlbmd0aCA+IHJlbWFpbmluZykgbGVuZ3RoID0gcmVtYWluaW5nXG5cbiAgaWYgKChzdHJpbmcubGVuZ3RoID4gMCAmJiAobGVuZ3RoIDwgMCB8fCBvZmZzZXQgPCAwKSkgfHwgb2Zmc2V0ID4gdGhpcy5sZW5ndGgpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignYXR0ZW1wdCB0byB3cml0ZSBvdXRzaWRlIGJ1ZmZlciBib3VuZHMnKVxuICB9XG5cbiAgaWYgKCFlbmNvZGluZykgZW5jb2RpbmcgPSAndXRmOCdcblxuICB2YXIgbG93ZXJlZENhc2UgPSBmYWxzZVxuICBmb3IgKDs7KSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpV3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGJpbmFyeVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIC8vIFdhcm5pbmc6IG1heExlbmd0aCBub3QgdGFrZW4gaW50byBhY2NvdW50IGluIGJhc2U2NFdyaXRlXG4gICAgICAgIHJldHVybiBiYXNlNjRXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdWNzMldyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9ICgnJyArIGVuY29kaW5nKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvSlNPTiA9IGZ1bmN0aW9uIHRvSlNPTiAoKSB7XG4gIHJldHVybiB7XG4gICAgdHlwZTogJ0J1ZmZlcicsXG4gICAgZGF0YTogQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwodGhpcy5fYXJyIHx8IHRoaXMsIDApXG4gIH1cbn1cblxuZnVuY3Rpb24gYmFzZTY0U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBpZiAoc3RhcnQgPT09IDAgJiYgZW5kID09PSBidWYubGVuZ3RoKSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1ZilcbiAgfSBlbHNlIHtcbiAgICByZXR1cm4gYmFzZTY0LmZyb21CeXRlQXJyYXkoYnVmLnNsaWNlKHN0YXJ0LCBlbmQpKVxuICB9XG59XG5cbmZ1bmN0aW9uIHV0ZjhTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcbiAgdmFyIHJlcyA9IFtdXG5cbiAgdmFyIGkgPSBzdGFydFxuICB3aGlsZSAoaSA8IGVuZCkge1xuICAgIHZhciBmaXJzdEJ5dGUgPSBidWZbaV1cbiAgICB2YXIgY29kZVBvaW50ID0gbnVsbFxuICAgIHZhciBieXRlc1BlclNlcXVlbmNlID0gKGZpcnN0Qnl0ZSA+IDB4RUYpID8gNFxuICAgICAgOiAoZmlyc3RCeXRlID4gMHhERikgPyAzXG4gICAgICA6IChmaXJzdEJ5dGUgPiAweEJGKSA/IDJcbiAgICAgIDogMVxuXG4gICAgaWYgKGkgKyBieXRlc1BlclNlcXVlbmNlIDw9IGVuZCkge1xuICAgICAgdmFyIHNlY29uZEJ5dGUsIHRoaXJkQnl0ZSwgZm91cnRoQnl0ZSwgdGVtcENvZGVQb2ludFxuXG4gICAgICBzd2l0Y2ggKGJ5dGVzUGVyU2VxdWVuY2UpIHtcbiAgICAgICAgY2FzZSAxOlxuICAgICAgICAgIGlmIChmaXJzdEJ5dGUgPCAweDgwKSB7XG4gICAgICAgICAgICBjb2RlUG9pbnQgPSBmaXJzdEJ5dGVcbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAyOlxuICAgICAgICAgIHNlY29uZEJ5dGUgPSBidWZbaSArIDFdXG4gICAgICAgICAgaWYgKChzZWNvbmRCeXRlICYgMHhDMCkgPT09IDB4ODApIHtcbiAgICAgICAgICAgIHRlbXBDb2RlUG9pbnQgPSAoZmlyc3RCeXRlICYgMHgxRikgPDwgMHg2IHwgKHNlY29uZEJ5dGUgJiAweDNGKVxuICAgICAgICAgICAgaWYgKHRlbXBDb2RlUG9pbnQgPiAweDdGKSB7XG4gICAgICAgICAgICAgIGNvZGVQb2ludCA9IHRlbXBDb2RlUG9pbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSAzOlxuICAgICAgICAgIHNlY29uZEJ5dGUgPSBidWZbaSArIDFdXG4gICAgICAgICAgdGhpcmRCeXRlID0gYnVmW2kgKyAyXVxuICAgICAgICAgIGlmICgoc2Vjb25kQnl0ZSAmIDB4QzApID09PSAweDgwICYmICh0aGlyZEJ5dGUgJiAweEMwKSA9PT0gMHg4MCkge1xuICAgICAgICAgICAgdGVtcENvZGVQb2ludCA9IChmaXJzdEJ5dGUgJiAweEYpIDw8IDB4QyB8IChzZWNvbmRCeXRlICYgMHgzRikgPDwgMHg2IHwgKHRoaXJkQnl0ZSAmIDB4M0YpXG4gICAgICAgICAgICBpZiAodGVtcENvZGVQb2ludCA+IDB4N0ZGICYmICh0ZW1wQ29kZVBvaW50IDwgMHhEODAwIHx8IHRlbXBDb2RlUG9pbnQgPiAweERGRkYpKSB7XG4gICAgICAgICAgICAgIGNvZGVQb2ludCA9IHRlbXBDb2RlUG9pbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICAgICAgYnJlYWtcbiAgICAgICAgY2FzZSA0OlxuICAgICAgICAgIHNlY29uZEJ5dGUgPSBidWZbaSArIDFdXG4gICAgICAgICAgdGhpcmRCeXRlID0gYnVmW2kgKyAyXVxuICAgICAgICAgIGZvdXJ0aEJ5dGUgPSBidWZbaSArIDNdXG4gICAgICAgICAgaWYgKChzZWNvbmRCeXRlICYgMHhDMCkgPT09IDB4ODAgJiYgKHRoaXJkQnl0ZSAmIDB4QzApID09PSAweDgwICYmIChmb3VydGhCeXRlICYgMHhDMCkgPT09IDB4ODApIHtcbiAgICAgICAgICAgIHRlbXBDb2RlUG9pbnQgPSAoZmlyc3RCeXRlICYgMHhGKSA8PCAweDEyIHwgKHNlY29uZEJ5dGUgJiAweDNGKSA8PCAweEMgfCAodGhpcmRCeXRlICYgMHgzRikgPDwgMHg2IHwgKGZvdXJ0aEJ5dGUgJiAweDNGKVxuICAgICAgICAgICAgaWYgKHRlbXBDb2RlUG9pbnQgPiAweEZGRkYgJiYgdGVtcENvZGVQb2ludCA8IDB4MTEwMDAwKSB7XG4gICAgICAgICAgICAgIGNvZGVQb2ludCA9IHRlbXBDb2RlUG9pbnRcbiAgICAgICAgICAgIH1cbiAgICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuXG4gICAgaWYgKGNvZGVQb2ludCA9PT0gbnVsbCkge1xuICAgICAgLy8gd2UgZGlkIG5vdCBnZW5lcmF0ZSBhIHZhbGlkIGNvZGVQb2ludCBzbyBpbnNlcnQgYVxuICAgICAgLy8gcmVwbGFjZW1lbnQgY2hhciAoVStGRkZEKSBhbmQgYWR2YW5jZSBvbmx5IDEgYnl0ZVxuICAgICAgY29kZVBvaW50ID0gMHhGRkZEXG4gICAgICBieXRlc1BlclNlcXVlbmNlID0gMVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50ID4gMHhGRkZGKSB7XG4gICAgICAvLyBlbmNvZGUgdG8gdXRmMTYgKHN1cnJvZ2F0ZSBwYWlyIGRhbmNlKVxuICAgICAgY29kZVBvaW50IC09IDB4MTAwMDBcbiAgICAgIHJlcy5wdXNoKGNvZGVQb2ludCA+Pj4gMTAgJiAweDNGRiB8IDB4RDgwMClcbiAgICAgIGNvZGVQb2ludCA9IDB4REMwMCB8IGNvZGVQb2ludCAmIDB4M0ZGXG4gICAgfVxuXG4gICAgcmVzLnB1c2goY29kZVBvaW50KVxuICAgIGkgKz0gYnl0ZXNQZXJTZXF1ZW5jZVxuICB9XG5cbiAgcmV0dXJuIGRlY29kZUNvZGVQb2ludHNBcnJheShyZXMpXG59XG5cbi8vIEJhc2VkIG9uIGh0dHA6Ly9zdGFja292ZXJmbG93LmNvbS9hLzIyNzQ3MjcyLzY4MDc0MiwgdGhlIGJyb3dzZXIgd2l0aFxuLy8gdGhlIGxvd2VzdCBsaW1pdCBpcyBDaHJvbWUsIHdpdGggMHgxMDAwMCBhcmdzLlxuLy8gV2UgZ28gMSBtYWduaXR1ZGUgbGVzcywgZm9yIHNhZmV0eVxudmFyIE1BWF9BUkdVTUVOVFNfTEVOR1RIID0gMHgxMDAwXG5cbmZ1bmN0aW9uIGRlY29kZUNvZGVQb2ludHNBcnJheSAoY29kZVBvaW50cykge1xuICB2YXIgbGVuID0gY29kZVBvaW50cy5sZW5ndGhcbiAgaWYgKGxlbiA8PSBNQVhfQVJHVU1FTlRTX0xFTkdUSCkge1xuICAgIHJldHVybiBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KFN0cmluZywgY29kZVBvaW50cykgLy8gYXZvaWQgZXh0cmEgc2xpY2UoKVxuICB9XG5cbiAgLy8gRGVjb2RlIGluIGNodW5rcyB0byBhdm9pZCBcImNhbGwgc3RhY2sgc2l6ZSBleGNlZWRlZFwiLlxuICB2YXIgcmVzID0gJydcbiAgdmFyIGkgPSAwXG4gIHdoaWxlIChpIDwgbGVuKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUuYXBwbHkoXG4gICAgICBTdHJpbmcsXG4gICAgICBjb2RlUG9pbnRzLnNsaWNlKGksIGkgKz0gTUFYX0FSR1VNRU5UU19MRU5HVEgpXG4gICAgKVxuICB9XG4gIHJldHVybiByZXNcbn1cblxuZnVuY3Rpb24gYXNjaWlTbGljZSAoYnVmLCBzdGFydCwgZW5kKSB7XG4gIHZhciByZXQgPSAnJ1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG5cbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICByZXQgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShidWZbaV0gJiAweDdGKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuZnVuY3Rpb24gYmluYXJ5U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldKVxuICB9XG4gIHJldHVybiByZXRcbn1cblxuZnVuY3Rpb24gaGV4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gYnVmLmxlbmd0aFxuXG4gIGlmICghc3RhcnQgfHwgc3RhcnQgPCAwKSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgfHwgZW5kIDwgMCB8fCBlbmQgPiBsZW4pIGVuZCA9IGxlblxuXG4gIHZhciBvdXQgPSAnJ1xuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIG91dCArPSB0b0hleChidWZbaV0pXG4gIH1cbiAgcmV0dXJuIG91dFxufVxuXG5mdW5jdGlvbiB1dGYxNmxlU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgYnl0ZXMgPSBidWYuc2xpY2Uoc3RhcnQsIGVuZClcbiAgdmFyIHJlcyA9ICcnXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYnl0ZXMubGVuZ3RoOyBpICs9IDIpIHtcbiAgICByZXMgKz0gU3RyaW5nLmZyb21DaGFyQ29kZShieXRlc1tpXSArIGJ5dGVzW2kgKyAxXSAqIDI1NilcbiAgfVxuICByZXR1cm4gcmVzXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUuc2xpY2UgPSBmdW5jdGlvbiBzbGljZSAoc3RhcnQsIGVuZCkge1xuICB2YXIgbGVuID0gdGhpcy5sZW5ndGhcbiAgc3RhcnQgPSB+fnN0YXJ0XG4gIGVuZCA9IGVuZCA9PT0gdW5kZWZpbmVkID8gbGVuIDogfn5lbmRcblxuICBpZiAoc3RhcnQgPCAwKSB7XG4gICAgc3RhcnQgKz0gbGVuXG4gICAgaWYgKHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIH0gZWxzZSBpZiAoc3RhcnQgPiBsZW4pIHtcbiAgICBzdGFydCA9IGxlblxuICB9XG5cbiAgaWYgKGVuZCA8IDApIHtcbiAgICBlbmQgKz0gbGVuXG4gICAgaWYgKGVuZCA8IDApIGVuZCA9IDBcbiAgfSBlbHNlIGlmIChlbmQgPiBsZW4pIHtcbiAgICBlbmQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICB2YXIgbmV3QnVmXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIG5ld0J1ZiA9IEJ1ZmZlci5fYXVnbWVudCh0aGlzLnN1YmFycmF5KHN0YXJ0LCBlbmQpKVxuICB9IGVsc2Uge1xuICAgIHZhciBzbGljZUxlbiA9IGVuZCAtIHN0YXJ0XG4gICAgbmV3QnVmID0gbmV3IEJ1ZmZlcihzbGljZUxlbiwgdW5kZWZpbmVkKVxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc2xpY2VMZW47IGkrKykge1xuICAgICAgbmV3QnVmW2ldID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9XG5cbiAgaWYgKG5ld0J1Zi5sZW5ndGgpIG5ld0J1Zi5wYXJlbnQgPSB0aGlzLnBhcmVudCB8fCB0aGlzXG5cbiAgcmV0dXJuIG5ld0J1ZlxufVxuXG4vKlxuICogTmVlZCB0byBtYWtlIHN1cmUgdGhhdCBidWZmZXIgaXNuJ3QgdHJ5aW5nIHRvIHdyaXRlIG91dCBvZiBib3VuZHMuXG4gKi9cbmZ1bmN0aW9uIGNoZWNrT2Zmc2V0IChvZmZzZXQsIGV4dCwgbGVuZ3RoKSB7XG4gIGlmICgob2Zmc2V0ICUgMSkgIT09IDAgfHwgb2Zmc2V0IDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ29mZnNldCBpcyBub3QgdWludCcpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBsZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdUcnlpbmcgdG8gYWNjZXNzIGJleW9uZCBidWZmZXIgbGVuZ3RoJylcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludExFID0gZnVuY3Rpb24gcmVhZFVJbnRMRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIGJ5dGVMZW5ndGgsIHRoaXMubGVuZ3RoKVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldF1cbiAgdmFyIG11bCA9IDFcbiAgdmFyIGkgPSAwXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgaV0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludEJFID0gZnVuY3Rpb24gcmVhZFVJbnRCRSAob2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGJ5dGVMZW5ndGggPSBieXRlTGVuZ3RoIHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcbiAgfVxuXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF1cbiAgdmFyIG11bCA9IDFcbiAgd2hpbGUgKGJ5dGVMZW5ndGggPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1ieXRlTGVuZ3RoXSAqIG11bFxuICB9XG5cbiAgcmV0dXJuIHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50OCA9IGZ1bmN0aW9uIHJlYWRVSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQxNkxFID0gZnVuY3Rpb24gcmVhZFVJbnQxNkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiB0aGlzW29mZnNldF0gfCAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gKHRoaXNbb2Zmc2V0XSA8PCA4KSB8IHRoaXNbb2Zmc2V0ICsgMV1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDMyTEUgPSBmdW5jdGlvbiByZWFkVUludDMyTEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA0LCB0aGlzLmxlbmd0aClcblxuICByZXR1cm4gKCh0aGlzW29mZnNldF0pIHxcbiAgICAgICh0aGlzW29mZnNldCArIDFdIDw8IDgpIHxcbiAgICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSkgK1xuICAgICAgKHRoaXNbb2Zmc2V0ICsgM10gKiAweDEwMDAwMDApXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkJFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gKiAweDEwMDAwMDApICtcbiAgICAoKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgdGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50TEUgPSBmdW5jdGlvbiByZWFkSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cbiAgbXVsICo9IDB4ODBcblxuICBpZiAodmFsID49IG11bCkgdmFsIC09IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50QkUgPSBmdW5jdGlvbiByZWFkSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGhcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgLS1pXVxuICB3aGlsZSAoaSA+IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyAtLWldICogbXVsXG4gIH1cbiAgbXVsICo9IDB4ODBcblxuICBpZiAodmFsID49IG11bCkgdmFsIC09IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50OCA9IGZ1bmN0aW9uIHJlYWRJbnQ4IChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMSwgdGhpcy5sZW5ndGgpXG4gIGlmICghKHRoaXNbb2Zmc2V0XSAmIDB4ODApKSByZXR1cm4gKHRoaXNbb2Zmc2V0XSlcbiAgcmV0dXJuICgoMHhmZiAtIHRoaXNbb2Zmc2V0XSArIDEpICogLTEpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDE2TEUgPSBmdW5jdGlvbiByZWFkSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbiAgcmV0dXJuICh2YWwgJiAweDgwMDApID8gdmFsIHwgMHhGRkZGMDAwMCA6IHZhbFxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkJFID0gZnVuY3Rpb24gcmVhZEludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0ICsgMV0gfCAodGhpc1tvZmZzZXRdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJMRSA9IGZ1bmN0aW9uIHJlYWRJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0pIHxcbiAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAzXSA8PCAyNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRJbnQzMkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgMjQpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCAxNikgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDgpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAzXSlcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRMRSA9IGZ1bmN0aW9uIHJlYWRGbG9hdExFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCAyMywgNClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRmxvYXRCRSA9IGZ1bmN0aW9uIHJlYWRGbG9hdEJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUxFID0gZnVuY3Rpb24gcmVhZERvdWJsZUxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCB0cnVlLCA1MiwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkRG91YmxlQkUgPSBmdW5jdGlvbiByZWFkRG91YmxlQkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCA4LCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIGllZWU3NTQucmVhZCh0aGlzLCBvZmZzZXQsIGZhbHNlLCA1MiwgOClcbn1cblxuZnVuY3Rpb24gY2hlY2tJbnQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihidWYpKSB0aHJvdyBuZXcgVHlwZUVycm9yKCdidWZmZXIgbXVzdCBiZSBhIEJ1ZmZlciBpbnN0YW5jZScpXG4gIGlmICh2YWx1ZSA+IG1heCB8fCB2YWx1ZSA8IG1pbikgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3ZhbHVlIGlzIG91dCBvZiBib3VuZHMnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gYnVmLmxlbmd0aCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50TEUgPSBmdW5jdGlvbiB3cml0ZVVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpLCAwKVxuXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB0aGlzW29mZnNldF0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKHZhbHVlIC8gbXVsKSAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50QkUgPSBmdW5jdGlvbiB3cml0ZVVJbnRCRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGgpLCAwKVxuXG4gIHZhciBpID0gYnl0ZUxlbmd0aCAtIDFcbiAgdmFyIG11bCA9IDFcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKHZhbHVlIC8gbXVsKSAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50OCA9IGZ1bmN0aW9uIHdyaXRlVUludDggKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMSwgMHhmZiwgMClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICByZXR1cm4gb2Zmc2V0ICsgMVxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQxNiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmYgKyB2YWx1ZSArIDFcbiAgZm9yICh2YXIgaSA9IDAsIGogPSBNYXRoLm1pbihidWYubGVuZ3RoIC0gb2Zmc2V0LCAyKTsgaSA8IGo7IGkrKykge1xuICAgIGJ1ZltvZmZzZXQgKyBpXSA9ICh2YWx1ZSAmICgweGZmIDw8ICg4ICogKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkpKSkgPj4+XG4gICAgICAobGl0dGxlRW5kaWFuID8gaSA6IDEgLSBpKSAqIDhcbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZVVJbnQxNkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4ZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gdmFsdWVcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5mdW5jdGlvbiBvYmplY3RXcml0ZVVJbnQzMiAoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4pIHtcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmZmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgNCk7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgPj4+IChsaXR0bGVFbmRpYW4gPyBpIDogMyAtIGkpICogOCkgJiAweGZmXG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldCArIDNdID0gKHZhbHVlID4+PiAyNClcbiAgICB0aGlzW29mZnNldCArIDJdID0gKHZhbHVlID4+PiAxNilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZVVJbnQzMkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4ZmZmZmZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50TEUgPSBmdW5jdGlvbiB3cml0ZUludExFICh2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIHtcbiAgICB2YXIgbGltaXQgPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aCAtIDEpXG5cbiAgICBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBieXRlTGVuZ3RoLCBsaW1pdCAtIDEsIC1saW1pdClcbiAgfVxuXG4gIHZhciBpID0gMFxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gdmFsdWUgPCAwID8gMSA6IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICgodmFsdWUgLyBtdWwpID4+IDApIC0gc3ViICYgMHhGRlxuICB9XG5cbiAgcmV0dXJuIG9mZnNldCArIGJ5dGVMZW5ndGhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludEJFID0gZnVuY3Rpb24gd3JpdGVJbnRCRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIGxpbWl0ID0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKVxuXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbGltaXQgLSAxLCAtbGltaXQpXG4gIH1cblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHZhciBzdWIgPSB2YWx1ZSA8IDAgPyAxIDogMFxuICB0aGlzW29mZnNldCArIGldID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgtLWkgPj0gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQ4ID0gZnVuY3Rpb24gd3JpdGVJbnQ4ICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4N2YsIC0weDgwKVxuICBpZiAoIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB2YWx1ZSA9IE1hdGguZmxvb3IodmFsdWUpXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZiArIHZhbHVlICsgMVxuICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICByZXR1cm4gb2Zmc2V0ICsgMVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9IHZhbHVlXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQxNkJFID0gZnVuY3Rpb24gd3JpdGVJbnQxNkJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDIsIDB4N2ZmZiwgLTB4ODAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSB2YWx1ZVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDE2KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnQzMkxFID0gZnVuY3Rpb24gd3JpdGVJbnQzMkxFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDQsIDB4N2ZmZmZmZmYsIC0weDgwMDAwMDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSB2YWx1ZVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKHZhbHVlIDwgMCkgdmFsdWUgPSAweGZmZmZmZmZmICsgdmFsdWUgKyAxXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDNdID0gdmFsdWVcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQzMih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5mdW5jdGlvbiBjaGVja0lFRUU3NTQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgZXh0LCBtYXgsIG1pbikge1xuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxuICBpZiAob2Zmc2V0IDwgMCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2luZGV4IG91dCBvZiByYW5nZScpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRmxvYXQgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgNCwgMy40MDI4MjM0NjYzODUyODg2ZSszOCwgLTMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgMjMsIDQpXG4gIHJldHVybiBvZmZzZXQgKyA0XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdExFID0gZnVuY3Rpb24gd3JpdGVGbG9hdExFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUZsb2F0QkUgPSBmdW5jdGlvbiB3cml0ZUZsb2F0QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZUZsb2F0KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuZnVuY3Rpb24gd3JpdGVEb3VibGUgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgY2hlY2tJRUVFNzU0KGJ1ZiwgdmFsdWUsIG9mZnNldCwgOCwgMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgsIC0xLjc5NzY5MzEzNDg2MjMxNTdFKzMwOClcbiAgfVxuICBpZWVlNzU0LndyaXRlKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuLCA1MiwgOClcbiAgcmV0dXJuIG9mZnNldCArIDhcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUxFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUsIG5vQXNzZXJ0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRG91YmxlQkUgPSBmdW5jdGlvbiB3cml0ZURvdWJsZUJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVEb3VibGUodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UsIG5vQXNzZXJ0KVxufVxuXG4vLyBjb3B5KHRhcmdldEJ1ZmZlciwgdGFyZ2V0U3RhcnQ9MCwgc291cmNlU3RhcnQ9MCwgc291cmNlRW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmNvcHkgPSBmdW5jdGlvbiBjb3B5ICh0YXJnZXQsIHRhcmdldFN0YXJ0LCBzdGFydCwgZW5kKSB7XG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCAmJiBlbmQgIT09IDApIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmICh0YXJnZXRTdGFydCA+PSB0YXJnZXQubGVuZ3RoKSB0YXJnZXRTdGFydCA9IHRhcmdldC5sZW5ndGhcbiAgaWYgKCF0YXJnZXRTdGFydCkgdGFyZ2V0U3RhcnQgPSAwXG4gIGlmIChlbmQgPiAwICYmIGVuZCA8IHN0YXJ0KSBlbmQgPSBzdGFydFxuXG4gIC8vIENvcHkgMCBieXRlczsgd2UncmUgZG9uZVxuICBpZiAoZW5kID09PSBzdGFydCkgcmV0dXJuIDBcbiAgaWYgKHRhcmdldC5sZW5ndGggPT09IDAgfHwgdGhpcy5sZW5ndGggPT09IDApIHJldHVybiAwXG5cbiAgLy8gRmF0YWwgZXJyb3IgY29uZGl0aW9uc1xuICBpZiAodGFyZ2V0U3RhcnQgPCAwKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ3RhcmdldFN0YXJ0IG91dCBvZiBib3VuZHMnKVxuICB9XG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdzb3VyY2VFbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgLy8gQXJlIHdlIG9vYj9cbiAgaWYgKGVuZCA+IHRoaXMubGVuZ3RoKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0IDwgZW5kIC0gc3RhcnQpIHtcbiAgICBlbmQgPSB0YXJnZXQubGVuZ3RoIC0gdGFyZ2V0U3RhcnQgKyBzdGFydFxuICB9XG5cbiAgdmFyIGxlbiA9IGVuZCAtIHN0YXJ0XG4gIHZhciBpXG5cbiAgaWYgKHRoaXMgPT09IHRhcmdldCAmJiBzdGFydCA8IHRhcmdldFN0YXJ0ICYmIHRhcmdldFN0YXJ0IDwgZW5kKSB7XG4gICAgLy8gZGVzY2VuZGluZyBjb3B5IGZyb20gZW5kXG4gICAgZm9yIChpID0gbGVuIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2UgaWYgKGxlbiA8IDEwMDAgfHwgIUJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gYXNjZW5kaW5nIGNvcHkgZnJvbSBzdGFydFxuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgICAgdGFyZ2V0W2kgKyB0YXJnZXRTdGFydF0gPSB0aGlzW2kgKyBzdGFydF1cbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGFyZ2V0Ll9zZXQodGhpcy5zdWJhcnJheShzdGFydCwgc3RhcnQgKyBsZW4pLCB0YXJnZXRTdGFydClcbiAgfVxuXG4gIHJldHVybiBsZW5cbn1cblxuLy8gZmlsbCh2YWx1ZSwgc3RhcnQ9MCwgZW5kPWJ1ZmZlci5sZW5ndGgpXG5CdWZmZXIucHJvdG90eXBlLmZpbGwgPSBmdW5jdGlvbiBmaWxsICh2YWx1ZSwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXZhbHVlKSB2YWx1ZSA9IDBcbiAgaWYgKCFzdGFydCkgc3RhcnQgPSAwXG4gIGlmICghZW5kKSBlbmQgPSB0aGlzLmxlbmd0aFxuXG4gIGlmIChlbmQgPCBzdGFydCkgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2VuZCA8IHN0YXJ0JylcblxuICAvLyBGaWxsIDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVyblxuICBpZiAodGhpcy5sZW5ndGggPT09IDApIHJldHVyblxuXG4gIGlmIChzdGFydCA8IDAgfHwgc3RhcnQgPj0gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdzdGFydCBvdXQgb2YgYm91bmRzJylcbiAgaWYgKGVuZCA8IDAgfHwgZW5kID4gdGhpcy5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgb3V0IG9mIGJvdW5kcycpXG5cbiAgdmFyIGlcbiAgaWYgKHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicpIHtcbiAgICBmb3IgKGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgICB0aGlzW2ldID0gdmFsdWVcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdmFyIGJ5dGVzID0gdXRmOFRvQnl0ZXModmFsdWUudG9TdHJpbmcoKSlcbiAgICB2YXIgbGVuID0gYnl0ZXMubGVuZ3RoXG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IGJ5dGVzW2kgJSBsZW5dXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXNcbn1cblxuLyoqXG4gKiBDcmVhdGVzIGEgbmV3IGBBcnJheUJ1ZmZlcmAgd2l0aCB0aGUgKmNvcGllZCogbWVtb3J5IG9mIHRoZSBidWZmZXIgaW5zdGFuY2UuXG4gKiBBZGRlZCBpbiBOb2RlIDAuMTIuIE9ubHkgYXZhaWxhYmxlIGluIGJyb3dzZXJzIHRoYXQgc3VwcG9ydCBBcnJheUJ1ZmZlci5cbiAqL1xuQnVmZmVyLnByb3RvdHlwZS50b0FycmF5QnVmZmVyID0gZnVuY3Rpb24gdG9BcnJheUJ1ZmZlciAoKSB7XG4gIGlmICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICAgIHJldHVybiAobmV3IEJ1ZmZlcih0aGlzKSkuYnVmZmVyXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBidWYgPSBuZXcgVWludDhBcnJheSh0aGlzLmxlbmd0aClcbiAgICAgIGZvciAodmFyIGkgPSAwLCBsZW4gPSBidWYubGVuZ3RoOyBpIDwgbGVuOyBpICs9IDEpIHtcbiAgICAgICAgYnVmW2ldID0gdGhpc1tpXVxuICAgICAgfVxuICAgICAgcmV0dXJuIGJ1Zi5idWZmZXJcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQnVmZmVyLnRvQXJyYXlCdWZmZXIgbm90IHN1cHBvcnRlZCBpbiB0aGlzIGJyb3dzZXInKVxuICB9XG59XG5cbi8vIEhFTFBFUiBGVU5DVElPTlNcbi8vID09PT09PT09PT09PT09PT1cblxudmFyIEJQID0gQnVmZmVyLnByb3RvdHlwZVxuXG4vKipcbiAqIEF1Z21lbnQgYSBVaW50OEFycmF5ICppbnN0YW5jZSogKG5vdCB0aGUgVWludDhBcnJheSBjbGFzcyEpIHdpdGggQnVmZmVyIG1ldGhvZHNcbiAqL1xuQnVmZmVyLl9hdWdtZW50ID0gZnVuY3Rpb24gX2F1Z21lbnQgKGFycikge1xuICBhcnIuY29uc3RydWN0b3IgPSBCdWZmZXJcbiAgYXJyLl9pc0J1ZmZlciA9IHRydWVcblxuICAvLyBzYXZlIHJlZmVyZW5jZSB0byBvcmlnaW5hbCBVaW50OEFycmF5IHNldCBtZXRob2QgYmVmb3JlIG92ZXJ3cml0aW5nXG4gIGFyci5fc2V0ID0gYXJyLnNldFxuXG4gIC8vIGRlcHJlY2F0ZWRcbiAgYXJyLmdldCA9IEJQLmdldFxuICBhcnIuc2V0ID0gQlAuc2V0XG5cbiAgYXJyLndyaXRlID0gQlAud3JpdGVcbiAgYXJyLnRvU3RyaW5nID0gQlAudG9TdHJpbmdcbiAgYXJyLnRvTG9jYWxlU3RyaW5nID0gQlAudG9TdHJpbmdcbiAgYXJyLnRvSlNPTiA9IEJQLnRvSlNPTlxuICBhcnIuZXF1YWxzID0gQlAuZXF1YWxzXG4gIGFyci5jb21wYXJlID0gQlAuY29tcGFyZVxuICBhcnIuaW5kZXhPZiA9IEJQLmluZGV4T2ZcbiAgYXJyLmNvcHkgPSBCUC5jb3B5XG4gIGFyci5zbGljZSA9IEJQLnNsaWNlXG4gIGFyci5yZWFkVUludExFID0gQlAucmVhZFVJbnRMRVxuICBhcnIucmVhZFVJbnRCRSA9IEJQLnJlYWRVSW50QkVcbiAgYXJyLnJlYWRVSW50OCA9IEJQLnJlYWRVSW50OFxuICBhcnIucmVhZFVJbnQxNkxFID0gQlAucmVhZFVJbnQxNkxFXG4gIGFyci5yZWFkVUludDE2QkUgPSBCUC5yZWFkVUludDE2QkVcbiAgYXJyLnJlYWRVSW50MzJMRSA9IEJQLnJlYWRVSW50MzJMRVxuICBhcnIucmVhZFVJbnQzMkJFID0gQlAucmVhZFVJbnQzMkJFXG4gIGFyci5yZWFkSW50TEUgPSBCUC5yZWFkSW50TEVcbiAgYXJyLnJlYWRJbnRCRSA9IEJQLnJlYWRJbnRCRVxuICBhcnIucmVhZEludDggPSBCUC5yZWFkSW50OFxuICBhcnIucmVhZEludDE2TEUgPSBCUC5yZWFkSW50MTZMRVxuICBhcnIucmVhZEludDE2QkUgPSBCUC5yZWFkSW50MTZCRVxuICBhcnIucmVhZEludDMyTEUgPSBCUC5yZWFkSW50MzJMRVxuICBhcnIucmVhZEludDMyQkUgPSBCUC5yZWFkSW50MzJCRVxuICBhcnIucmVhZEZsb2F0TEUgPSBCUC5yZWFkRmxvYXRMRVxuICBhcnIucmVhZEZsb2F0QkUgPSBCUC5yZWFkRmxvYXRCRVxuICBhcnIucmVhZERvdWJsZUxFID0gQlAucmVhZERvdWJsZUxFXG4gIGFyci5yZWFkRG91YmxlQkUgPSBCUC5yZWFkRG91YmxlQkVcbiAgYXJyLndyaXRlVUludDggPSBCUC53cml0ZVVJbnQ4XG4gIGFyci53cml0ZVVJbnRMRSA9IEJQLndyaXRlVUludExFXG4gIGFyci53cml0ZVVJbnRCRSA9IEJQLndyaXRlVUludEJFXG4gIGFyci53cml0ZVVJbnQxNkxFID0gQlAud3JpdGVVSW50MTZMRVxuICBhcnIud3JpdGVVSW50MTZCRSA9IEJQLndyaXRlVUludDE2QkVcbiAgYXJyLndyaXRlVUludDMyTEUgPSBCUC53cml0ZVVJbnQzMkxFXG4gIGFyci53cml0ZVVJbnQzMkJFID0gQlAud3JpdGVVSW50MzJCRVxuICBhcnIud3JpdGVJbnRMRSA9IEJQLndyaXRlSW50TEVcbiAgYXJyLndyaXRlSW50QkUgPSBCUC53cml0ZUludEJFXG4gIGFyci53cml0ZUludDggPSBCUC53cml0ZUludDhcbiAgYXJyLndyaXRlSW50MTZMRSA9IEJQLndyaXRlSW50MTZMRVxuICBhcnIud3JpdGVJbnQxNkJFID0gQlAud3JpdGVJbnQxNkJFXG4gIGFyci53cml0ZUludDMyTEUgPSBCUC53cml0ZUludDMyTEVcbiAgYXJyLndyaXRlSW50MzJCRSA9IEJQLndyaXRlSW50MzJCRVxuICBhcnIud3JpdGVGbG9hdExFID0gQlAud3JpdGVGbG9hdExFXG4gIGFyci53cml0ZUZsb2F0QkUgPSBCUC53cml0ZUZsb2F0QkVcbiAgYXJyLndyaXRlRG91YmxlTEUgPSBCUC53cml0ZURvdWJsZUxFXG4gIGFyci53cml0ZURvdWJsZUJFID0gQlAud3JpdGVEb3VibGVCRVxuICBhcnIuZmlsbCA9IEJQLmZpbGxcbiAgYXJyLmluc3BlY3QgPSBCUC5pbnNwZWN0XG4gIGFyci50b0FycmF5QnVmZmVyID0gQlAudG9BcnJheUJ1ZmZlclxuXG4gIHJldHVybiBhcnJcbn1cblxudmFyIElOVkFMSURfQkFTRTY0X1JFID0gL1teK1xcLzAtOUEtWmEtei1fXS9nXG5cbmZ1bmN0aW9uIGJhc2U2NGNsZWFuIChzdHIpIHtcbiAgLy8gTm9kZSBzdHJpcHMgb3V0IGludmFsaWQgY2hhcmFjdGVycyBsaWtlIFxcbiBhbmQgXFx0IGZyb20gdGhlIHN0cmluZywgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHN0ciA9IHN0cmluZ3RyaW0oc3RyKS5yZXBsYWNlKElOVkFMSURfQkFTRTY0X1JFLCAnJylcbiAgLy8gTm9kZSBjb252ZXJ0cyBzdHJpbmdzIHdpdGggbGVuZ3RoIDwgMiB0byAnJ1xuICBpZiAoc3RyLmxlbmd0aCA8IDIpIHJldHVybiAnJ1xuICAvLyBOb2RlIGFsbG93cyBmb3Igbm9uLXBhZGRlZCBiYXNlNjQgc3RyaW5ncyAobWlzc2luZyB0cmFpbGluZyA9PT0pLCBiYXNlNjQtanMgZG9lcyBub3RcbiAgd2hpbGUgKHN0ci5sZW5ndGggJSA0ICE9PSAwKSB7XG4gICAgc3RyID0gc3RyICsgJz0nXG4gIH1cbiAgcmV0dXJuIHN0clxufVxuXG5mdW5jdGlvbiBzdHJpbmd0cmltIChzdHIpIHtcbiAgaWYgKHN0ci50cmltKSByZXR1cm4gc3RyLnRyaW0oKVxuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMrfFxccyskL2csICcnKVxufVxuXG5mdW5jdGlvbiB0b0hleCAobikge1xuICBpZiAobiA8IDE2KSByZXR1cm4gJzAnICsgbi50b1N0cmluZygxNilcbiAgcmV0dXJuIG4udG9TdHJpbmcoMTYpXG59XG5cbmZ1bmN0aW9uIHV0ZjhUb0J5dGVzIChzdHJpbmcsIHVuaXRzKSB7XG4gIHVuaXRzID0gdW5pdHMgfHwgSW5maW5pdHlcbiAgdmFyIGNvZGVQb2ludFxuICB2YXIgbGVuZ3RoID0gc3RyaW5nLmxlbmd0aFxuICB2YXIgbGVhZFN1cnJvZ2F0ZSA9IG51bGxcbiAgdmFyIGJ5dGVzID0gW11cblxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgY29kZVBvaW50ID0gc3RyaW5nLmNoYXJDb2RlQXQoaSlcblxuICAgIC8vIGlzIHN1cnJvZ2F0ZSBjb21wb25lbnRcbiAgICBpZiAoY29kZVBvaW50ID4gMHhEN0ZGICYmIGNvZGVQb2ludCA8IDB4RTAwMCkge1xuICAgICAgLy8gbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICAgIGlmICghbGVhZFN1cnJvZ2F0ZSkge1xuICAgICAgICAvLyBubyBsZWFkIHlldFxuICAgICAgICBpZiAoY29kZVBvaW50ID4gMHhEQkZGKSB7XG4gICAgICAgICAgLy8gdW5leHBlY3RlZCB0cmFpbFxuICAgICAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH0gZWxzZSBpZiAoaSArIDEgPT09IGxlbmd0aCkge1xuICAgICAgICAgIC8vIHVucGFpcmVkIGxlYWRcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gdmFsaWQgbGVhZFxuICAgICAgICBsZWFkU3Vycm9nYXRlID0gY29kZVBvaW50XG5cbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLy8gMiBsZWFkcyBpbiBhIHJvd1xuICAgICAgaWYgKGNvZGVQb2ludCA8IDB4REMwMCkge1xuICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuICAgICAgICBjb250aW51ZVxuICAgICAgfVxuXG4gICAgICAvLyB2YWxpZCBzdXJyb2dhdGUgcGFpclxuICAgICAgY29kZVBvaW50ID0gbGVhZFN1cnJvZ2F0ZSAtIDB4RDgwMCA8PCAxMCB8IGNvZGVQb2ludCAtIDB4REMwMCB8IDB4MTAwMDBcbiAgICB9IGVsc2UgaWYgKGxlYWRTdXJyb2dhdGUpIHtcbiAgICAgIC8vIHZhbGlkIGJtcCBjaGFyLCBidXQgbGFzdCBjaGFyIHdhcyBhIGxlYWRcbiAgICAgIGlmICgodW5pdHMgLT0gMykgPiAtMSkgYnl0ZXMucHVzaCgweEVGLCAweEJGLCAweEJEKVxuICAgIH1cblxuICAgIGxlYWRTdXJyb2dhdGUgPSBudWxsXG5cbiAgICAvLyBlbmNvZGUgdXRmOFxuICAgIGlmIChjb2RlUG9pbnQgPCAweDgwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDEpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goY29kZVBvaW50KVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHg4MDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiB8IDB4QzAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDEwMDAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDMpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgfCAweEUwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHg2ICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCAmIDB4M0YgfCAweDgwXG4gICAgICApXG4gICAgfSBlbHNlIGlmIChjb2RlUG9pbnQgPCAweDExMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSA0KSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHgxMiB8IDB4RjAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweEMgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgY29kZSBwb2ludCcpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVzXG59XG5cbmZ1bmN0aW9uIGFzY2lpVG9CeXRlcyAoc3RyKSB7XG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIC8vIE5vZGUncyBjb2RlIHNlZW1zIHRvIGJlIGRvaW5nIHRoaXMgYW5kIG5vdCAmIDB4N0YuLlxuICAgIGJ5dGVBcnJheS5wdXNoKHN0ci5jaGFyQ29kZUF0KGkpICYgMHhGRilcbiAgfVxuICByZXR1cm4gYnl0ZUFycmF5XG59XG5cbmZ1bmN0aW9uIHV0ZjE2bGVUb0J5dGVzIChzdHIsIHVuaXRzKSB7XG4gIHZhciBjLCBoaSwgbG9cbiAgdmFyIGJ5dGVBcnJheSA9IFtdXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgc3RyLmxlbmd0aDsgaSsrKSB7XG4gICAgaWYgKCh1bml0cyAtPSAyKSA8IDApIGJyZWFrXG5cbiAgICBjID0gc3RyLmNoYXJDb2RlQXQoaSlcbiAgICBoaSA9IGMgPj4gOFxuICAgIGxvID0gYyAlIDI1NlxuICAgIGJ5dGVBcnJheS5wdXNoKGxvKVxuICAgIGJ5dGVBcnJheS5wdXNoKGhpKVxuICB9XG5cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiBiYXNlNjRUb0J5dGVzIChzdHIpIHtcbiAgcmV0dXJuIGJhc2U2NC50b0J5dGVBcnJheShiYXNlNjRjbGVhbihzdHIpKVxufVxuXG5mdW5jdGlvbiBibGl0QnVmZmVyIChzcmMsIGRzdCwgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGlmICgoaSArIG9mZnNldCA+PSBkc3QubGVuZ3RoKSB8fCAoaSA+PSBzcmMubGVuZ3RoKSkgYnJlYWtcbiAgICBkc3RbaSArIG9mZnNldF0gPSBzcmNbaV1cbiAgfVxuICByZXR1cm4gaVxufVxuIiwidmFyIGxvb2t1cCA9ICdBQkNERUZHSElKS0xNTk9QUVJTVFVWV1hZWmFiY2RlZmdoaWprbG1ub3BxcnN0dXZ3eHl6MDEyMzQ1Njc4OSsvJztcblxuOyhmdW5jdGlvbiAoZXhwb3J0cykge1xuXHQndXNlIHN0cmljdCc7XG5cbiAgdmFyIEFyciA9ICh0eXBlb2YgVWludDhBcnJheSAhPT0gJ3VuZGVmaW5lZCcpXG4gICAgPyBVaW50OEFycmF5XG4gICAgOiBBcnJheVxuXG5cdHZhciBQTFVTICAgPSAnKycuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0ggID0gJy8nLmNoYXJDb2RlQXQoMClcblx0dmFyIE5VTUJFUiA9ICcwJy5jaGFyQ29kZUF0KDApXG5cdHZhciBMT1dFUiAgPSAnYScuY2hhckNvZGVBdCgwKVxuXHR2YXIgVVBQRVIgID0gJ0EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFBMVVNfVVJMX1NBRkUgPSAnLScuY2hhckNvZGVBdCgwKVxuXHR2YXIgU0xBU0hfVVJMX1NBRkUgPSAnXycuY2hhckNvZGVBdCgwKVxuXG5cdGZ1bmN0aW9uIGRlY29kZSAoZWx0KSB7XG5cdFx0dmFyIGNvZGUgPSBlbHQuY2hhckNvZGVBdCgwKVxuXHRcdGlmIChjb2RlID09PSBQTFVTIHx8XG5cdFx0ICAgIGNvZGUgPT09IFBMVVNfVVJMX1NBRkUpXG5cdFx0XHRyZXR1cm4gNjIgLy8gJysnXG5cdFx0aWYgKGNvZGUgPT09IFNMQVNIIHx8XG5cdFx0ICAgIGNvZGUgPT09IFNMQVNIX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYzIC8vICcvJ1xuXHRcdGlmIChjb2RlIDwgTlVNQkVSKVxuXHRcdFx0cmV0dXJuIC0xIC8vbm8gbWF0Y2hcblx0XHRpZiAoY29kZSA8IE5VTUJFUiArIDEwKVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBOVU1CRVIgKyAyNiArIDI2XG5cdFx0aWYgKGNvZGUgPCBVUFBFUiArIDI2KVxuXHRcdFx0cmV0dXJuIGNvZGUgLSBVUFBFUlxuXHRcdGlmIChjb2RlIDwgTE9XRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gTE9XRVIgKyAyNlxuXHR9XG5cblx0ZnVuY3Rpb24gYjY0VG9CeXRlQXJyYXkgKGI2NCkge1xuXHRcdHZhciBpLCBqLCBsLCB0bXAsIHBsYWNlSG9sZGVycywgYXJyXG5cblx0XHRpZiAoYjY0Lmxlbmd0aCAlIDQgPiAwKSB7XG5cdFx0XHR0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgc3RyaW5nLiBMZW5ndGggbXVzdCBiZSBhIG11bHRpcGxlIG9mIDQnKVxuXHRcdH1cblxuXHRcdC8vIHRoZSBudW1iZXIgb2YgZXF1YWwgc2lnbnMgKHBsYWNlIGhvbGRlcnMpXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHR3byBwbGFjZWhvbGRlcnMsIHRoYW4gdGhlIHR3byBjaGFyYWN0ZXJzIGJlZm9yZSBpdFxuXHRcdC8vIHJlcHJlc2VudCBvbmUgYnl0ZVxuXHRcdC8vIGlmIHRoZXJlIGlzIG9ubHkgb25lLCB0aGVuIHRoZSB0aHJlZSBjaGFyYWN0ZXJzIGJlZm9yZSBpdCByZXByZXNlbnQgMiBieXRlc1xuXHRcdC8vIHRoaXMgaXMganVzdCBhIGNoZWFwIGhhY2sgdG8gbm90IGRvIGluZGV4T2YgdHdpY2Vcblx0XHR2YXIgbGVuID0gYjY0Lmxlbmd0aFxuXHRcdHBsYWNlSG9sZGVycyA9ICc9JyA9PT0gYjY0LmNoYXJBdChsZW4gLSAyKSA/IDIgOiAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMSkgPyAxIDogMFxuXG5cdFx0Ly8gYmFzZTY0IGlzIDQvMyArIHVwIHRvIHR3byBjaGFyYWN0ZXJzIG9mIHRoZSBvcmlnaW5hbCBkYXRhXG5cdFx0YXJyID0gbmV3IEFycihiNjQubGVuZ3RoICogMyAvIDQgLSBwbGFjZUhvbGRlcnMpXG5cblx0XHQvLyBpZiB0aGVyZSBhcmUgcGxhY2Vob2xkZXJzLCBvbmx5IGdldCB1cCB0byB0aGUgbGFzdCBjb21wbGV0ZSA0IGNoYXJzXG5cdFx0bCA9IHBsYWNlSG9sZGVycyA+IDAgPyBiNjQubGVuZ3RoIC0gNCA6IGI2NC5sZW5ndGhcblxuXHRcdHZhciBMID0gMFxuXG5cdFx0ZnVuY3Rpb24gcHVzaCAodikge1xuXHRcdFx0YXJyW0wrK10gPSB2XG5cdFx0fVxuXG5cdFx0Zm9yIChpID0gMCwgaiA9IDA7IGkgPCBsOyBpICs9IDQsIGogKz0gMykge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxOCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCAxMikgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA8PCA2KSB8IGRlY29kZShiNjQuY2hhckF0KGkgKyAzKSlcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMDAwKSA+PiAxNilcblx0XHRcdHB1c2goKHRtcCAmIDB4RkYwMCkgPj4gOClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRpZiAocGxhY2VIb2xkZXJzID09PSAyKSB7XG5cdFx0XHR0bXAgPSAoZGVjb2RlKGI2NC5jaGFyQXQoaSkpIDw8IDIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPj4gNClcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9IGVsc2UgaWYgKHBsYWNlSG9sZGVycyA9PT0gMSkge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAxMCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDEpKSA8PCA0KSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMikpID4+IDIpXG5cdFx0XHRwdXNoKCh0bXAgPj4gOCkgJiAweEZGKVxuXHRcdFx0cHVzaCh0bXAgJiAweEZGKVxuXHRcdH1cblxuXHRcdHJldHVybiBhcnJcblx0fVxuXG5cdGZ1bmN0aW9uIHVpbnQ4VG9CYXNlNjQgKHVpbnQ4KSB7XG5cdFx0dmFyIGksXG5cdFx0XHRleHRyYUJ5dGVzID0gdWludDgubGVuZ3RoICUgMywgLy8gaWYgd2UgaGF2ZSAxIGJ5dGUgbGVmdCwgcGFkIDIgYnl0ZXNcblx0XHRcdG91dHB1dCA9IFwiXCIsXG5cdFx0XHR0ZW1wLCBsZW5ndGhcblxuXHRcdGZ1bmN0aW9uIGVuY29kZSAobnVtKSB7XG5cdFx0XHRyZXR1cm4gbG9va3VwLmNoYXJBdChudW0pXG5cdFx0fVxuXG5cdFx0ZnVuY3Rpb24gdHJpcGxldFRvQmFzZTY0IChudW0pIHtcblx0XHRcdHJldHVybiBlbmNvZGUobnVtID4+IDE4ICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDEyICYgMHgzRikgKyBlbmNvZGUobnVtID4+IDYgJiAweDNGKSArIGVuY29kZShudW0gJiAweDNGKVxuXHRcdH1cblxuXHRcdC8vIGdvIHRocm91Z2ggdGhlIGFycmF5IGV2ZXJ5IHRocmVlIGJ5dGVzLCB3ZSdsbCBkZWFsIHdpdGggdHJhaWxpbmcgc3R1ZmYgbGF0ZXJcblx0XHRmb3IgKGkgPSAwLCBsZW5ndGggPSB1aW50OC5sZW5ndGggLSBleHRyYUJ5dGVzOyBpIDwgbGVuZ3RoOyBpICs9IDMpIHtcblx0XHRcdHRlbXAgPSAodWludDhbaV0gPDwgMTYpICsgKHVpbnQ4W2kgKyAxXSA8PCA4KSArICh1aW50OFtpICsgMl0pXG5cdFx0XHRvdXRwdXQgKz0gdHJpcGxldFRvQmFzZTY0KHRlbXApXG5cdFx0fVxuXG5cdFx0Ly8gcGFkIHRoZSBlbmQgd2l0aCB6ZXJvcywgYnV0IG1ha2Ugc3VyZSB0byBub3QgZm9yZ2V0IHRoZSBleHRyYSBieXRlc1xuXHRcdHN3aXRjaCAoZXh0cmFCeXRlcykge1xuXHRcdFx0Y2FzZSAxOlxuXHRcdFx0XHR0ZW1wID0gdWludDhbdWludDgubGVuZ3RoIC0gMV1cblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDIpXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPDwgNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gJz09J1xuXHRcdFx0XHRicmVha1xuXHRcdFx0Y2FzZSAyOlxuXHRcdFx0XHR0ZW1wID0gKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDJdIDw8IDgpICsgKHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKHRlbXAgPj4gMTApXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUoKHRlbXAgPj4gNCkgJiAweDNGKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDIpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9J1xuXHRcdFx0XHRicmVha1xuXHRcdH1cblxuXHRcdHJldHVybiBvdXRwdXRcblx0fVxuXG5cdGV4cG9ydHMudG9CeXRlQXJyYXkgPSBiNjRUb0J5dGVBcnJheVxuXHRleHBvcnRzLmZyb21CeXRlQXJyYXkgPSB1aW50OFRvQmFzZTY0XG59KHR5cGVvZiBleHBvcnRzID09PSAndW5kZWZpbmVkJyA/ICh0aGlzLmJhc2U2NGpzID0ge30pIDogZXhwb3J0cykpXG4iLCJleHBvcnRzLnJlYWQgPSBmdW5jdGlvbiAoYnVmZmVyLCBvZmZzZXQsIGlzTEUsIG1MZW4sIG5CeXRlcykge1xuICB2YXIgZSwgbVxuICB2YXIgZUxlbiA9IG5CeXRlcyAqIDggLSBtTGVuIC0gMVxuICB2YXIgZU1heCA9ICgxIDw8IGVMZW4pIC0gMVxuICB2YXIgZUJpYXMgPSBlTWF4ID4+IDFcbiAgdmFyIG5CaXRzID0gLTdcbiAgdmFyIGkgPSBpc0xFID8gKG5CeXRlcyAtIDEpIDogMFxuICB2YXIgZCA9IGlzTEUgPyAtMSA6IDFcbiAgdmFyIHMgPSBidWZmZXJbb2Zmc2V0ICsgaV1cblxuICBpICs9IGRcblxuICBlID0gcyAmICgoMSA8PCAoLW5CaXRzKSkgLSAxKVxuICBzID4+PSAoLW5CaXRzKVxuICBuQml0cyArPSBlTGVuXG4gIGZvciAoOyBuQml0cyA+IDA7IGUgPSBlICogMjU2ICsgYnVmZmVyW29mZnNldCArIGldLCBpICs9IGQsIG5CaXRzIC09IDgpIHt9XG5cbiAgbSA9IGUgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgZSA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gbUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBtID0gbSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIGlmIChlID09PSAwKSB7XG4gICAgZSA9IDEgLSBlQmlhc1xuICB9IGVsc2UgaWYgKGUgPT09IGVNYXgpIHtcbiAgICByZXR1cm4gbSA/IE5hTiA6ICgocyA/IC0xIDogMSkgKiBJbmZpbml0eSlcbiAgfSBlbHNlIHtcbiAgICBtID0gbSArIE1hdGgucG93KDIsIG1MZW4pXG4gICAgZSA9IGUgLSBlQmlhc1xuICB9XG4gIHJldHVybiAocyA/IC0xIDogMSkgKiBtICogTWF0aC5wb3coMiwgZSAtIG1MZW4pXG59XG5cbmV4cG9ydHMud3JpdGUgPSBmdW5jdGlvbiAoYnVmZmVyLCB2YWx1ZSwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG0sIGNcbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBydCA9IChtTGVuID09PSAyMyA/IE1hdGgucG93KDIsIC0yNCkgLSBNYXRoLnBvdygyLCAtNzcpIDogMClcbiAgdmFyIGkgPSBpc0xFID8gMCA6IChuQnl0ZXMgLSAxKVxuICB2YXIgZCA9IGlzTEUgPyAxIDogLTFcbiAgdmFyIHMgPSB2YWx1ZSA8IDAgfHwgKHZhbHVlID09PSAwICYmIDEgLyB2YWx1ZSA8IDApID8gMSA6IDBcblxuICB2YWx1ZSA9IE1hdGguYWJzKHZhbHVlKVxuXG4gIGlmIChpc05hTih2YWx1ZSkgfHwgdmFsdWUgPT09IEluZmluaXR5KSB7XG4gICAgbSA9IGlzTmFOKHZhbHVlKSA/IDEgOiAwXG4gICAgZSA9IGVNYXhcbiAgfSBlbHNlIHtcbiAgICBlID0gTWF0aC5mbG9vcihNYXRoLmxvZyh2YWx1ZSkgLyBNYXRoLkxOMilcbiAgICBpZiAodmFsdWUgKiAoYyA9IE1hdGgucG93KDIsIC1lKSkgPCAxKSB7XG4gICAgICBlLS1cbiAgICAgIGMgKj0gMlxuICAgIH1cbiAgICBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIHZhbHVlICs9IHJ0IC8gY1xuICAgIH0gZWxzZSB7XG4gICAgICB2YWx1ZSArPSBydCAqIE1hdGgucG93KDIsIDEgLSBlQmlhcylcbiAgICB9XG4gICAgaWYgKHZhbHVlICogYyA+PSAyKSB7XG4gICAgICBlKytcbiAgICAgIGMgLz0gMlxuICAgIH1cblxuICAgIGlmIChlICsgZUJpYXMgPj0gZU1heCkge1xuICAgICAgbSA9IDBcbiAgICAgIGUgPSBlTWF4XG4gICAgfSBlbHNlIGlmIChlICsgZUJpYXMgPj0gMSkge1xuICAgICAgbSA9ICh2YWx1ZSAqIGMgLSAxKSAqIE1hdGgucG93KDIsIG1MZW4pXG4gICAgICBlID0gZSArIGVCaWFzXG4gICAgfSBlbHNlIHtcbiAgICAgIG0gPSB2YWx1ZSAqIE1hdGgucG93KDIsIGVCaWFzIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IDBcbiAgICB9XG4gIH1cblxuICBmb3IgKDsgbUxlbiA+PSA4OyBidWZmZXJbb2Zmc2V0ICsgaV0gPSBtICYgMHhmZiwgaSArPSBkLCBtIC89IDI1NiwgbUxlbiAtPSA4KSB7fVxuXG4gIGUgPSAoZSA8PCBtTGVuKSB8IG1cbiAgZUxlbiArPSBtTGVuXG4gIGZvciAoOyBlTGVuID4gMDsgYnVmZmVyW29mZnNldCArIGldID0gZSAmIDB4ZmYsIGkgKz0gZCwgZSAvPSAyNTYsIGVMZW4gLT0gOCkge31cblxuICBidWZmZXJbb2Zmc2V0ICsgaSAtIGRdIHw9IHMgKiAxMjhcbn1cbiIsIlxuLyoqXG4gKiBpc0FycmF5XG4gKi9cblxudmFyIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5O1xuXG4vKipcbiAqIHRvU3RyaW5nXG4gKi9cblxudmFyIHN0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogV2hldGhlciBvciBub3QgdGhlIGdpdmVuIGB2YWxgXG4gKiBpcyBhbiBhcnJheS5cbiAqXG4gKiBleGFtcGxlOlxuICpcbiAqICAgICAgICBpc0FycmF5KFtdKTtcbiAqICAgICAgICAvLyA+IHRydWVcbiAqICAgICAgICBpc0FycmF5KGFyZ3VtZW50cyk7XG4gKiAgICAgICAgLy8gPiBmYWxzZVxuICogICAgICAgIGlzQXJyYXkoJycpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqXG4gKiBAcGFyYW0ge21peGVkfSB2YWxcbiAqIEByZXR1cm4ge2Jvb2x9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBpc0FycmF5IHx8IGZ1bmN0aW9uICh2YWwpIHtcbiAgcmV0dXJuICEhIHZhbCAmJiAnW29iamVjdCBBcnJheV0nID09IHN0ci5jYWxsKHZhbCk7XG59O1xuIiwiLy8gQ29weXJpZ2h0IEpveWVudCwgSW5jLiBhbmQgb3RoZXIgTm9kZSBjb250cmlidXRvcnMuXG4vL1xuLy8gUGVybWlzc2lvbiBpcyBoZXJlYnkgZ3JhbnRlZCwgZnJlZSBvZiBjaGFyZ2UsIHRvIGFueSBwZXJzb24gb2J0YWluaW5nIGFcbi8vIGNvcHkgb2YgdGhpcyBzb2Z0d2FyZSBhbmQgYXNzb2NpYXRlZCBkb2N1bWVudGF0aW9uIGZpbGVzICh0aGVcbi8vIFwiU29mdHdhcmVcIiksIHRvIGRlYWwgaW4gdGhlIFNvZnR3YXJlIHdpdGhvdXQgcmVzdHJpY3Rpb24sIGluY2x1ZGluZ1xuLy8gd2l0aG91dCBsaW1pdGF0aW9uIHRoZSByaWdodHMgdG8gdXNlLCBjb3B5LCBtb2RpZnksIG1lcmdlLCBwdWJsaXNoLFxuLy8gZGlzdHJpYnV0ZSwgc3VibGljZW5zZSwgYW5kL29yIHNlbGwgY29waWVzIG9mIHRoZSBTb2Z0d2FyZSwgYW5kIHRvIHBlcm1pdFxuLy8gcGVyc29ucyB0byB3aG9tIHRoZSBTb2Z0d2FyZSBpcyBmdXJuaXNoZWQgdG8gZG8gc28sIHN1YmplY3QgdG8gdGhlXG4vLyBmb2xsb3dpbmcgY29uZGl0aW9uczpcbi8vXG4vLyBUaGUgYWJvdmUgY29weXJpZ2h0IG5vdGljZSBhbmQgdGhpcyBwZXJtaXNzaW9uIG5vdGljZSBzaGFsbCBiZSBpbmNsdWRlZFxuLy8gaW4gYWxsIGNvcGllcyBvciBzdWJzdGFudGlhbCBwb3J0aW9ucyBvZiB0aGUgU29mdHdhcmUuXG4vL1xuLy8gVEhFIFNPRlRXQVJFIElTIFBST1ZJREVEIFwiQVMgSVNcIiwgV0lUSE9VVCBXQVJSQU5UWSBPRiBBTlkgS0lORCwgRVhQUkVTU1xuLy8gT1IgSU1QTElFRCwgSU5DTFVESU5HIEJVVCBOT1QgTElNSVRFRCBUTyBUSEUgV0FSUkFOVElFUyBPRlxuLy8gTUVSQ0hBTlRBQklMSVRZLCBGSVRORVNTIEZPUiBBIFBBUlRJQ1VMQVIgUFVSUE9TRSBBTkQgTk9OSU5GUklOR0VNRU5ULiBJTlxuLy8gTk8gRVZFTlQgU0hBTEwgVEhFIEFVVEhPUlMgT1IgQ09QWVJJR0hUIEhPTERFUlMgQkUgTElBQkxFIEZPUiBBTlkgQ0xBSU0sXG4vLyBEQU1BR0VTIE9SIE9USEVSIExJQUJJTElUWSwgV0hFVEhFUiBJTiBBTiBBQ1RJT04gT0YgQ09OVFJBQ1QsIFRPUlQgT1Jcbi8vIE9USEVSV0lTRSwgQVJJU0lORyBGUk9NLCBPVVQgT0YgT1IgSU4gQ09OTkVDVElPTiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEVcbi8vIFVTRSBPUiBPVEhFUiBERUFMSU5HUyBJTiBUSEUgU09GVFdBUkUuXG5cbmZ1bmN0aW9uIEV2ZW50RW1pdHRlcigpIHtcbiAgdGhpcy5fZXZlbnRzID0gdGhpcy5fZXZlbnRzIHx8IHt9O1xuICB0aGlzLl9tYXhMaXN0ZW5lcnMgPSB0aGlzLl9tYXhMaXN0ZW5lcnMgfHwgdW5kZWZpbmVkO1xufVxubW9kdWxlLmV4cG9ydHMgPSBFdmVudEVtaXR0ZXI7XG5cbi8vIEJhY2t3YXJkcy1jb21wYXQgd2l0aCBub2RlIDAuMTAueFxuRXZlbnRFbWl0dGVyLkV2ZW50RW1pdHRlciA9IEV2ZW50RW1pdHRlcjtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fZXZlbnRzID0gdW5kZWZpbmVkO1xuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5fbWF4TGlzdGVuZXJzID0gdW5kZWZpbmVkO1xuXG4vLyBCeSBkZWZhdWx0IEV2ZW50RW1pdHRlcnMgd2lsbCBwcmludCBhIHdhcm5pbmcgaWYgbW9yZSB0aGFuIDEwIGxpc3RlbmVycyBhcmVcbi8vIGFkZGVkIHRvIGl0LiBUaGlzIGlzIGEgdXNlZnVsIGRlZmF1bHQgd2hpY2ggaGVscHMgZmluZGluZyBtZW1vcnkgbGVha3MuXG5FdmVudEVtaXR0ZXIuZGVmYXVsdE1heExpc3RlbmVycyA9IDEwO1xuXG4vLyBPYnZpb3VzbHkgbm90IGFsbCBFbWl0dGVycyBzaG91bGQgYmUgbGltaXRlZCB0byAxMC4gVGhpcyBmdW5jdGlvbiBhbGxvd3Ncbi8vIHRoYXQgdG8gYmUgaW5jcmVhc2VkLiBTZXQgdG8gemVybyBmb3IgdW5saW1pdGVkLlxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5zZXRNYXhMaXN0ZW5lcnMgPSBmdW5jdGlvbihuKSB7XG4gIGlmICghaXNOdW1iZXIobikgfHwgbiA8IDAgfHwgaXNOYU4obikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCduIG11c3QgYmUgYSBwb3NpdGl2ZSBudW1iZXInKTtcbiAgdGhpcy5fbWF4TGlzdGVuZXJzID0gbjtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBlciwgaGFuZGxlciwgbGVuLCBhcmdzLCBpLCBsaXN0ZW5lcnM7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHMpXG4gICAgdGhpcy5fZXZlbnRzID0ge307XG5cbiAgLy8gSWYgdGhlcmUgaXMgbm8gJ2Vycm9yJyBldmVudCBsaXN0ZW5lciB0aGVuIHRocm93LlxuICBpZiAodHlwZSA9PT0gJ2Vycm9yJykge1xuICAgIGlmICghdGhpcy5fZXZlbnRzLmVycm9yIHx8XG4gICAgICAgIChpc09iamVjdCh0aGlzLl9ldmVudHMuZXJyb3IpICYmICF0aGlzLl9ldmVudHMuZXJyb3IubGVuZ3RoKSkge1xuICAgICAgZXIgPSBhcmd1bWVudHNbMV07XG4gICAgICBpZiAoZXIgaW5zdGFuY2VvZiBFcnJvcikge1xuICAgICAgICB0aHJvdyBlcjsgLy8gVW5oYW5kbGVkICdlcnJvcicgZXZlbnRcbiAgICAgIH1cbiAgICAgIHRocm93IFR5cGVFcnJvcignVW5jYXVnaHQsIHVuc3BlY2lmaWVkIFwiZXJyb3JcIiBldmVudC4nKTtcbiAgICB9XG4gIH1cblxuICBoYW5kbGVyID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc1VuZGVmaW5lZChoYW5kbGVyKSlcbiAgICByZXR1cm4gZmFsc2U7XG5cbiAgaWYgKGlzRnVuY3Rpb24oaGFuZGxlcikpIHtcbiAgICBzd2l0Y2ggKGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICAgIC8vIGZhc3QgY2FzZXNcbiAgICAgIGNhc2UgMTpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMpO1xuICAgICAgICBicmVhaztcbiAgICAgIGNhc2UgMjpcbiAgICAgICAgaGFuZGxlci5jYWxsKHRoaXMsIGFyZ3VtZW50c1sxXSk7XG4gICAgICAgIGJyZWFrO1xuICAgICAgY2FzZSAzOlxuICAgICAgICBoYW5kbGVyLmNhbGwodGhpcywgYXJndW1lbnRzWzFdLCBhcmd1bWVudHNbMl0pO1xuICAgICAgICBicmVhaztcbiAgICAgIC8vIHNsb3dlclxuICAgICAgZGVmYXVsdDpcbiAgICAgICAgbGVuID0gYXJndW1lbnRzLmxlbmd0aDtcbiAgICAgICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICAgICAgZm9yIChpID0gMTsgaSA8IGxlbjsgaSsrKVxuICAgICAgICAgIGFyZ3NbaSAtIDFdID0gYXJndW1lbnRzW2ldO1xuICAgICAgICBoYW5kbGVyLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIH1cbiAgfSBlbHNlIGlmIChpc09iamVjdChoYW5kbGVyKSkge1xuICAgIGxlbiA9IGFyZ3VtZW50cy5sZW5ndGg7XG4gICAgYXJncyA9IG5ldyBBcnJheShsZW4gLSAxKTtcbiAgICBmb3IgKGkgPSAxOyBpIDwgbGVuOyBpKyspXG4gICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcblxuICAgIGxpc3RlbmVycyA9IGhhbmRsZXIuc2xpY2UoKTtcbiAgICBsZW4gPSBsaXN0ZW5lcnMubGVuZ3RoO1xuICAgIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKylcbiAgICAgIGxpc3RlbmVyc1tpXS5hcHBseSh0aGlzLCBhcmdzKTtcbiAgfVxuXG4gIHJldHVybiB0cnVlO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5hZGRMaXN0ZW5lciA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIHZhciBtO1xuXG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICB0aGlzLl9ldmVudHMgPSB7fTtcblxuICAvLyBUbyBhdm9pZCByZWN1cnNpb24gaW4gdGhlIGNhc2UgdGhhdCB0eXBlID09PSBcIm5ld0xpc3RlbmVyXCIhIEJlZm9yZVxuICAvLyBhZGRpbmcgaXQgdG8gdGhlIGxpc3RlbmVycywgZmlyc3QgZW1pdCBcIm5ld0xpc3RlbmVyXCIuXG4gIGlmICh0aGlzLl9ldmVudHMubmV3TGlzdGVuZXIpXG4gICAgdGhpcy5lbWl0KCduZXdMaXN0ZW5lcicsIHR5cGUsXG4gICAgICAgICAgICAgIGlzRnVuY3Rpb24obGlzdGVuZXIubGlzdGVuZXIpID9cbiAgICAgICAgICAgICAgbGlzdGVuZXIubGlzdGVuZXIgOiBsaXN0ZW5lcik7XG5cbiAgaWYgKCF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgLy8gT3B0aW1pemUgdGhlIGNhc2Ugb2Ygb25lIGxpc3RlbmVyLiBEb24ndCBuZWVkIHRoZSBleHRyYSBhcnJheSBvYmplY3QuXG4gICAgdGhpcy5fZXZlbnRzW3R5cGVdID0gbGlzdGVuZXI7XG4gIGVsc2UgaWYgKGlzT2JqZWN0KHRoaXMuX2V2ZW50c1t0eXBlXSkpXG4gICAgLy8gSWYgd2UndmUgYWxyZWFkeSBnb3QgYW4gYXJyYXksIGp1c3QgYXBwZW5kLlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5wdXNoKGxpc3RlbmVyKTtcbiAgZWxzZVxuICAgIC8vIEFkZGluZyB0aGUgc2Vjb25kIGVsZW1lbnQsIG5lZWQgdG8gY2hhbmdlIHRvIGFycmF5LlxuICAgIHRoaXMuX2V2ZW50c1t0eXBlXSA9IFt0aGlzLl9ldmVudHNbdHlwZV0sIGxpc3RlbmVyXTtcblxuICAvLyBDaGVjayBmb3IgbGlzdGVuZXIgbGVha1xuICBpZiAoaXNPYmplY3QodGhpcy5fZXZlbnRzW3R5cGVdKSAmJiAhdGhpcy5fZXZlbnRzW3R5cGVdLndhcm5lZCkge1xuICAgIHZhciBtO1xuICAgIGlmICghaXNVbmRlZmluZWQodGhpcy5fbWF4TGlzdGVuZXJzKSkge1xuICAgICAgbSA9IHRoaXMuX21heExpc3RlbmVycztcbiAgICB9IGVsc2Uge1xuICAgICAgbSA9IEV2ZW50RW1pdHRlci5kZWZhdWx0TWF4TGlzdGVuZXJzO1xuICAgIH1cblxuICAgIGlmIChtICYmIG0gPiAwICYmIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGggPiBtKSB7XG4gICAgICB0aGlzLl9ldmVudHNbdHlwZV0ud2FybmVkID0gdHJ1ZTtcbiAgICAgIGNvbnNvbGUuZXJyb3IoJyhub2RlKSB3YXJuaW5nOiBwb3NzaWJsZSBFdmVudEVtaXR0ZXIgbWVtb3J5ICcgK1xuICAgICAgICAgICAgICAgICAgICAnbGVhayBkZXRlY3RlZC4gJWQgbGlzdGVuZXJzIGFkZGVkLiAnICtcbiAgICAgICAgICAgICAgICAgICAgJ1VzZSBlbWl0dGVyLnNldE1heExpc3RlbmVycygpIHRvIGluY3JlYXNlIGxpbWl0LicsXG4gICAgICAgICAgICAgICAgICAgIHRoaXMuX2V2ZW50c1t0eXBlXS5sZW5ndGgpO1xuICAgICAgaWYgKHR5cGVvZiBjb25zb2xlLnRyYWNlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIC8vIG5vdCBzdXBwb3J0ZWQgaW4gSUUgMTBcbiAgICAgICAgY29uc29sZS50cmFjZSgpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5vbiA9IEV2ZW50RW1pdHRlci5wcm90b3R5cGUuYWRkTGlzdGVuZXI7XG5cbkV2ZW50RW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKHR5cGUsIGxpc3RlbmVyKSB7XG4gIGlmICghaXNGdW5jdGlvbihsaXN0ZW5lcikpXG4gICAgdGhyb3cgVHlwZUVycm9yKCdsaXN0ZW5lciBtdXN0IGJlIGEgZnVuY3Rpb24nKTtcblxuICB2YXIgZmlyZWQgPSBmYWxzZTtcblxuICBmdW5jdGlvbiBnKCkge1xuICAgIHRoaXMucmVtb3ZlTGlzdGVuZXIodHlwZSwgZyk7XG5cbiAgICBpZiAoIWZpcmVkKSB7XG4gICAgICBmaXJlZCA9IHRydWU7XG4gICAgICBsaXN0ZW5lci5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgIH1cbiAgfVxuXG4gIGcubGlzdGVuZXIgPSBsaXN0ZW5lcjtcbiAgdGhpcy5vbih0eXBlLCBnKTtcblxuICByZXR1cm4gdGhpcztcbn07XG5cbi8vIGVtaXRzIGEgJ3JlbW92ZUxpc3RlbmVyJyBldmVudCBpZmYgdGhlIGxpc3RlbmVyIHdhcyByZW1vdmVkXG5FdmVudEVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID0gZnVuY3Rpb24odHlwZSwgbGlzdGVuZXIpIHtcbiAgdmFyIGxpc3QsIHBvc2l0aW9uLCBsZW5ndGgsIGk7XG5cbiAgaWYgKCFpc0Z1bmN0aW9uKGxpc3RlbmVyKSlcbiAgICB0aHJvdyBUeXBlRXJyb3IoJ2xpc3RlbmVyIG11c3QgYmUgYSBmdW5jdGlvbicpO1xuXG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0dXJuIHRoaXM7XG5cbiAgbGlzdCA9IHRoaXMuX2V2ZW50c1t0eXBlXTtcbiAgbGVuZ3RoID0gbGlzdC5sZW5ndGg7XG4gIHBvc2l0aW9uID0gLTE7XG5cbiAgaWYgKGxpc3QgPT09IGxpc3RlbmVyIHx8XG4gICAgICAoaXNGdW5jdGlvbihsaXN0Lmxpc3RlbmVyKSAmJiBsaXN0Lmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIGlmICh0aGlzLl9ldmVudHMucmVtb3ZlTGlzdGVuZXIpXG4gICAgICB0aGlzLmVtaXQoJ3JlbW92ZUxpc3RlbmVyJywgdHlwZSwgbGlzdGVuZXIpO1xuXG4gIH0gZWxzZSBpZiAoaXNPYmplY3QobGlzdCkpIHtcbiAgICBmb3IgKGkgPSBsZW5ndGg7IGktLSA+IDA7KSB7XG4gICAgICBpZiAobGlzdFtpXSA9PT0gbGlzdGVuZXIgfHxcbiAgICAgICAgICAobGlzdFtpXS5saXN0ZW5lciAmJiBsaXN0W2ldLmxpc3RlbmVyID09PSBsaXN0ZW5lcikpIHtcbiAgICAgICAgcG9zaXRpb24gPSBpO1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAocG9zaXRpb24gPCAwKVxuICAgICAgcmV0dXJuIHRoaXM7XG5cbiAgICBpZiAobGlzdC5sZW5ndGggPT09IDEpIHtcbiAgICAgIGxpc3QubGVuZ3RoID0gMDtcbiAgICAgIGRlbGV0ZSB0aGlzLl9ldmVudHNbdHlwZV07XG4gICAgfSBlbHNlIHtcbiAgICAgIGxpc3Quc3BsaWNlKHBvc2l0aW9uLCAxKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKVxuICAgICAgdGhpcy5lbWl0KCdyZW1vdmVMaXN0ZW5lcicsIHR5cGUsIGxpc3RlbmVyKTtcbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciBrZXksIGxpc3RlbmVycztcblxuICBpZiAoIXRoaXMuX2V2ZW50cylcbiAgICByZXR1cm4gdGhpcztcblxuICAvLyBub3QgbGlzdGVuaW5nIGZvciByZW1vdmVMaXN0ZW5lciwgbm8gbmVlZCB0byBlbWl0XG4gIGlmICghdGhpcy5fZXZlbnRzLnJlbW92ZUxpc3RlbmVyKSB7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDApXG4gICAgICB0aGlzLl9ldmVudHMgPSB7fTtcbiAgICBlbHNlIGlmICh0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gZW1pdCByZW1vdmVMaXN0ZW5lciBmb3IgYWxsIGxpc3RlbmVycyBvbiBhbGwgZXZlbnRzXG4gIGlmIChhcmd1bWVudHMubGVuZ3RoID09PSAwKSB7XG4gICAgZm9yIChrZXkgaW4gdGhpcy5fZXZlbnRzKSB7XG4gICAgICBpZiAoa2V5ID09PSAncmVtb3ZlTGlzdGVuZXInKSBjb250aW51ZTtcbiAgICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKGtleSk7XG4gICAgfVxuICAgIHRoaXMucmVtb3ZlQWxsTGlzdGVuZXJzKCdyZW1vdmVMaXN0ZW5lcicpO1xuICAgIHRoaXMuX2V2ZW50cyA9IHt9O1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgbGlzdGVuZXJzID0gdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIGlmIChpc0Z1bmN0aW9uKGxpc3RlbmVycykpIHtcbiAgICB0aGlzLnJlbW92ZUxpc3RlbmVyKHR5cGUsIGxpc3RlbmVycyk7XG4gIH0gZWxzZSB7XG4gICAgLy8gTElGTyBvcmRlclxuICAgIHdoaWxlIChsaXN0ZW5lcnMubGVuZ3RoKVxuICAgICAgdGhpcy5yZW1vdmVMaXN0ZW5lcih0eXBlLCBsaXN0ZW5lcnNbbGlzdGVuZXJzLmxlbmd0aCAtIDFdKTtcbiAgfVxuICBkZWxldGUgdGhpcy5fZXZlbnRzW3R5cGVdO1xuXG4gIHJldHVybiB0aGlzO1xufTtcblxuRXZlbnRFbWl0dGVyLnByb3RvdHlwZS5saXN0ZW5lcnMgPSBmdW5jdGlvbih0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghdGhpcy5fZXZlbnRzIHx8ICF0aGlzLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gW107XG4gIGVsc2UgaWYgKGlzRnVuY3Rpb24odGhpcy5fZXZlbnRzW3R5cGVdKSlcbiAgICByZXQgPSBbdGhpcy5fZXZlbnRzW3R5cGVdXTtcbiAgZWxzZVxuICAgIHJldCA9IHRoaXMuX2V2ZW50c1t0eXBlXS5zbGljZSgpO1xuICByZXR1cm4gcmV0O1xufTtcblxuRXZlbnRFbWl0dGVyLmxpc3RlbmVyQ291bnQgPSBmdW5jdGlvbihlbWl0dGVyLCB0eXBlKSB7XG4gIHZhciByZXQ7XG4gIGlmICghZW1pdHRlci5fZXZlbnRzIHx8ICFlbWl0dGVyLl9ldmVudHNbdHlwZV0pXG4gICAgcmV0ID0gMDtcbiAgZWxzZSBpZiAoaXNGdW5jdGlvbihlbWl0dGVyLl9ldmVudHNbdHlwZV0pKVxuICAgIHJldCA9IDE7XG4gIGVsc2VcbiAgICByZXQgPSBlbWl0dGVyLl9ldmVudHNbdHlwZV0ubGVuZ3RoO1xuICByZXR1cm4gcmV0O1xufTtcblxuZnVuY3Rpb24gaXNGdW5jdGlvbihhcmcpIHtcbiAgcmV0dXJuIHR5cGVvZiBhcmcgPT09ICdmdW5jdGlvbic7XG59XG5cbmZ1bmN0aW9uIGlzTnVtYmVyKGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ251bWJlcic7XG59XG5cbmZ1bmN0aW9uIGlzT2JqZWN0KGFyZykge1xuICByZXR1cm4gdHlwZW9mIGFyZyA9PT0gJ29iamVjdCcgJiYgYXJnICE9PSBudWxsO1xufVxuXG5mdW5jdGlvbiBpc1VuZGVmaW5lZChhcmcpIHtcbiAgcmV0dXJuIGFyZyA9PT0gdm9pZCAwO1xufVxuIiwiLy8gc2hpbSBmb3IgdXNpbmcgcHJvY2VzcyBpbiBicm93c2VyXG5cbnZhciBwcm9jZXNzID0gbW9kdWxlLmV4cG9ydHMgPSB7fTtcbnZhciBxdWV1ZSA9IFtdO1xudmFyIGRyYWluaW5nID0gZmFsc2U7XG52YXIgY3VycmVudFF1ZXVlO1xudmFyIHF1ZXVlSW5kZXggPSAtMTtcblxuZnVuY3Rpb24gY2xlYW5VcE5leHRUaWNrKCkge1xuICAgIGRyYWluaW5nID0gZmFsc2U7XG4gICAgaWYgKGN1cnJlbnRRdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgcXVldWUgPSBjdXJyZW50UXVldWUuY29uY2F0KHF1ZXVlKTtcbiAgICB9IGVsc2Uge1xuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgfVxuICAgIGlmIChxdWV1ZS5sZW5ndGgpIHtcbiAgICAgICAgZHJhaW5RdWV1ZSgpO1xuICAgIH1cbn1cblxuZnVuY3Rpb24gZHJhaW5RdWV1ZSgpIHtcbiAgICBpZiAoZHJhaW5pbmcpIHtcbiAgICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICB2YXIgdGltZW91dCA9IHNldFRpbWVvdXQoY2xlYW5VcE5leHRUaWNrKTtcbiAgICBkcmFpbmluZyA9IHRydWU7XG5cbiAgICB2YXIgbGVuID0gcXVldWUubGVuZ3RoO1xuICAgIHdoaWxlKGxlbikge1xuICAgICAgICBjdXJyZW50UXVldWUgPSBxdWV1ZTtcbiAgICAgICAgcXVldWUgPSBbXTtcbiAgICAgICAgd2hpbGUgKCsrcXVldWVJbmRleCA8IGxlbikge1xuICAgICAgICAgICAgaWYgKGN1cnJlbnRRdWV1ZSkge1xuICAgICAgICAgICAgICAgIGN1cnJlbnRRdWV1ZVtxdWV1ZUluZGV4XS5ydW4oKTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBxdWV1ZUluZGV4ID0gLTE7XG4gICAgICAgIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB9XG4gICAgY3VycmVudFF1ZXVlID0gbnVsbDtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGNsZWFyVGltZW91dCh0aW1lb3V0KTtcbn1cblxucHJvY2Vzcy5uZXh0VGljayA9IGZ1bmN0aW9uIChmdW4pIHtcbiAgICB2YXIgYXJncyA9IG5ldyBBcnJheShhcmd1bWVudHMubGVuZ3RoIC0gMSk7XG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSB7XG4gICAgICAgIGZvciAodmFyIGkgPSAxOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBhcmdzW2kgLSAxXSA9IGFyZ3VtZW50c1tpXTtcbiAgICAgICAgfVxuICAgIH1cbiAgICBxdWV1ZS5wdXNoKG5ldyBJdGVtKGZ1biwgYXJncykpO1xuICAgIGlmIChxdWV1ZS5sZW5ndGggPT09IDEgJiYgIWRyYWluaW5nKSB7XG4gICAgICAgIHNldFRpbWVvdXQoZHJhaW5RdWV1ZSwgMCk7XG4gICAgfVxufTtcblxuLy8gdjggbGlrZXMgcHJlZGljdGlibGUgb2JqZWN0c1xuZnVuY3Rpb24gSXRlbShmdW4sIGFycmF5KSB7XG4gICAgdGhpcy5mdW4gPSBmdW47XG4gICAgdGhpcy5hcnJheSA9IGFycmF5O1xufVxuSXRlbS5wcm90b3R5cGUucnVuID0gZnVuY3Rpb24gKCkge1xuICAgIHRoaXMuZnVuLmFwcGx5KG51bGwsIHRoaXMuYXJyYXkpO1xufTtcbnByb2Nlc3MudGl0bGUgPSAnYnJvd3Nlcic7XG5wcm9jZXNzLmJyb3dzZXIgPSB0cnVlO1xucHJvY2Vzcy5lbnYgPSB7fTtcbnByb2Nlc3MuYXJndiA9IFtdO1xucHJvY2Vzcy52ZXJzaW9uID0gJyc7IC8vIGVtcHR5IHN0cmluZyB0byBhdm9pZCByZWdleHAgaXNzdWVzXG5wcm9jZXNzLnZlcnNpb25zID0ge307XG5cbmZ1bmN0aW9uIG5vb3AoKSB7fVxuXG5wcm9jZXNzLm9uID0gbm9vcDtcbnByb2Nlc3MuYWRkTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5vbmNlID0gbm9vcDtcbnByb2Nlc3Mub2ZmID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlTGlzdGVuZXIgPSBub29wO1xucHJvY2Vzcy5yZW1vdmVBbGxMaXN0ZW5lcnMgPSBub29wO1xucHJvY2Vzcy5lbWl0ID0gbm9vcDtcblxucHJvY2Vzcy5iaW5kaW5nID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuYmluZGluZyBpcyBub3Qgc3VwcG9ydGVkJyk7XG59O1xuXG5wcm9jZXNzLmN3ZCA9IGZ1bmN0aW9uICgpIHsgcmV0dXJuICcvJyB9O1xucHJvY2Vzcy5jaGRpciA9IGZ1bmN0aW9uIChkaXIpIHtcbiAgICB0aHJvdyBuZXcgRXJyb3IoJ3Byb2Nlc3MuY2hkaXIgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcbnByb2Nlc3MudW1hc2sgPSBmdW5jdGlvbigpIHsgcmV0dXJuIDA7IH07XG4iLCIvKipcbiAqIE1vZHVsZSBkZXBlbmRlbmNpZXMuXG4gKi9cblxudmFyIEVtaXR0ZXIgPSByZXF1aXJlKCdjb21wb25lbnQtZW1pdHRlcicpXG5cbi8qKlxuICogRXhwb3NlIGBzY2VuZWAuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBBcHBsaWNhdGlvblxuXG4vKipcbiAqIENyZWF0ZSBhIG5ldyBgQXBwbGljYXRpb25gLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBlbGVtZW50IE9wdGlvbmFsIGluaXRpYWwgZWxlbWVudFxuICovXG5cbmZ1bmN0aW9uIEFwcGxpY2F0aW9uIChlbGVtZW50KSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBBcHBsaWNhdGlvbikpIHJldHVybiBuZXcgQXBwbGljYXRpb24oZWxlbWVudClcbiAgdGhpcy5vcHRpb25zID0ge31cbiAgdGhpcy5zb3VyY2VzID0ge31cbiAgdGhpcy5lbGVtZW50ID0gZWxlbWVudFxufVxuXG4vKipcbiAqIE1peGluIGBFbWl0dGVyYC5cbiAqL1xuXG5FbWl0dGVyKEFwcGxpY2F0aW9uLnByb3RvdHlwZSlcblxuLyoqXG4gKiBBZGQgYSBwbHVnaW5cbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBwbHVnaW5cbiAqL1xuXG5BcHBsaWNhdGlvbi5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24gKHBsdWdpbikge1xuICBwbHVnaW4odGhpcylcbiAgcmV0dXJuIHRoaXNcbn1cblxuLyoqXG4gKiBTZXQgYW4gb3B0aW9uXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVcbiAqL1xuXG5BcHBsaWNhdGlvbi5wcm90b3R5cGUub3B0aW9uID0gZnVuY3Rpb24gKG5hbWUsIHZhbCkge1xuICB0aGlzLm9wdGlvbnNbbmFtZV0gPSB2YWxcbiAgcmV0dXJuIHRoaXNcbn1cblxuLyoqXG4gKiBTZXQgdmFsdWUgdXNlZCBzb21ld2hlcmUgaW4gdGhlIElPIG5ldHdvcmsuXG4gKi9cblxuQXBwbGljYXRpb24ucHJvdG90eXBlLnNldCA9IGZ1bmN0aW9uIChuYW1lLCBkYXRhKSB7XG4gIHRoaXMuc291cmNlc1tuYW1lXSA9IGRhdGFcbiAgdGhpcy5lbWl0KCdzb3VyY2UnLCBuYW1lLCBkYXRhKVxuICByZXR1cm4gdGhpc1xufVxuXG4vKipcbiAqIE1vdW50IGEgdmlydHVhbCBlbGVtZW50LlxuICpcbiAqIEBwYXJhbSB7VmlydHVhbEVsZW1lbnR9IGVsZW1lbnRcbiAqL1xuXG5BcHBsaWNhdGlvbi5wcm90b3R5cGUubW91bnQgPSBmdW5jdGlvbiAoZWxlbWVudCkge1xuICB0aGlzLmVsZW1lbnQgPSBlbGVtZW50XG4gIHRoaXMuZW1pdCgnbW91bnQnLCBlbGVtZW50KVxuICByZXR1cm4gdGhpc1xufVxuXG4vKipcbiAqIFJlbW92ZSB0aGUgd29ybGQuIFVubW91bnQgZXZlcnl0aGluZy5cbiAqL1xuXG5BcHBsaWNhdGlvbi5wcm90b3R5cGUudW5tb3VudCA9IGZ1bmN0aW9uICgpIHtcbiAgaWYgKCF0aGlzLmVsZW1lbnQpIHJldHVyblxuICB0aGlzLmVsZW1lbnQgPSBudWxsXG4gIHRoaXMuZW1pdCgndW5tb3VudCcpXG4gIHJldHVybiB0aGlzXG59XG4iLCIvKipcbiAqIEFsbCBvZiB0aGUgZXZlbnRzIGNhbiBiaW5kIHRvXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSB7XG4gIG9uQmx1cjogJ2JsdXInLFxuICBvbkNoYW5nZTogJ2NoYW5nZScsXG4gIG9uQ2xpY2s6ICdjbGljaycsXG4gIG9uQ29udGV4dE1lbnU6ICdjb250ZXh0bWVudScsXG4gIG9uQ29weTogJ2NvcHknLFxuICBvbkN1dDogJ2N1dCcsXG4gIG9uRG91YmxlQ2xpY2s6ICdkYmxjbGljaycsXG4gIG9uRHJhZzogJ2RyYWcnLFxuICBvbkRyYWdFbmQ6ICdkcmFnZW5kJyxcbiAgb25EcmFnRW50ZXI6ICdkcmFnZW50ZXInLFxuICBvbkRyYWdFeGl0OiAnZHJhZ2V4aXQnLFxuICBvbkRyYWdMZWF2ZTogJ2RyYWdsZWF2ZScsXG4gIG9uRHJhZ092ZXI6ICdkcmFnb3ZlcicsXG4gIG9uRHJhZ1N0YXJ0OiAnZHJhZ3N0YXJ0JyxcbiAgb25Ecm9wOiAnZHJvcCcsXG4gIG9uRXJyb3I6ICdlcnJvcicsXG4gIG9uRm9jdXM6ICdmb2N1cycsXG4gIG9uSW5wdXQ6ICdpbnB1dCcsXG4gIG9uSW52YWxpZDogJ2ludmFsaWQnLFxuICBvbktleURvd246ICdrZXlkb3duJyxcbiAgb25LZXlQcmVzczogJ2tleXByZXNzJyxcbiAgb25LZXlVcDogJ2tleXVwJyxcbiAgb25Nb3VzZURvd246ICdtb3VzZWRvd24nLFxuICBvbk1vdXNlRW50ZXI6ICdtb3VzZWVudGVyJyxcbiAgb25Nb3VzZUxlYXZlOiAnbW91c2VsZWF2ZScsXG4gIG9uTW91c2VNb3ZlOiAnbW91c2Vtb3ZlJyxcbiAgb25Nb3VzZU91dDogJ21vdXNlb3V0JyxcbiAgb25Nb3VzZU92ZXI6ICdtb3VzZW92ZXInLFxuICBvbk1vdXNlVXA6ICdtb3VzZXVwJyxcbiAgb25QYXN0ZTogJ3Bhc3RlJyxcbiAgb25SZXNldDogJ3Jlc2V0JyxcbiAgb25TY3JvbGw6ICdzY3JvbGwnLFxuICBvblN1Ym1pdDogJ3N1Ym1pdCcsXG4gIG9uVG91Y2hDYW5jZWw6ICd0b3VjaGNhbmNlbCcsXG4gIG9uVG91Y2hFbmQ6ICd0b3VjaGVuZCcsXG4gIG9uVG91Y2hNb3ZlOiAndG91Y2htb3ZlJyxcbiAgb25Ub3VjaFN0YXJ0OiAndG91Y2hzdGFydCcsXG4gIG9uV2hlZWw6ICd3aGVlbCdcbn1cbiIsIi8qKlxuICogQ3JlYXRlIHRoZSBhcHBsaWNhdGlvbi5cbiAqL1xuXG5leHBvcnRzLnRyZWUgPVxuZXhwb3J0cy5zY2VuZSA9XG5leHBvcnRzLmRla3UgPSByZXF1aXJlKCcuL2FwcGxpY2F0aW9uJylcblxuLyoqXG4gKiBSZW5kZXIgc2NlbmVzIHRvIHRoZSBET00uXG4gKi9cblxuaWYgKHR5cGVvZiBkb2N1bWVudCAhPT0gJ3VuZGVmaW5lZCcpIHtcbiAgZXhwb3J0cy5yZW5kZXIgPSByZXF1aXJlKCcuL3JlbmRlcicpXG59XG5cbi8qKlxuICogUmVuZGVyIHNjZW5lcyB0byBhIHN0cmluZ1xuICovXG5cbmV4cG9ydHMucmVuZGVyU3RyaW5nID0gcmVxdWlyZSgnLi9zdHJpbmdpZnknKSIsInZhciB0eXBlID0gcmVxdWlyZSgnY29tcG9uZW50LXR5cGUnKVxuXG4vKipcbiAqIFJldHVybnMgdGhlIHR5cGUgb2YgYSB2aXJ0dWFsIG5vZGVcbiAqXG4gKiBAcGFyYW0gIHtPYmplY3R9IG5vZGVcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIG5vZGVUeXBlIChub2RlKSB7XG4gIHZhciB2ID0gdHlwZShub2RlKVxuICBpZiAodiA9PT0gJ251bGwnIHx8IG5vZGUgPT09IGZhbHNlKSByZXR1cm4gJ2VtcHR5J1xuICBpZiAodiAhPT0gJ29iamVjdCcpIHJldHVybiAndGV4dCdcbiAgaWYgKHR5cGUobm9kZS50eXBlKSA9PT0gJ3N0cmluZycpIHJldHVybiAnZWxlbWVudCdcbiAgcmV0dXJuICdjb21wb25lbnQnXG59XG4iLCIvKipcbiAqIERlcGVuZGVuY2llcy5cbiAqL1xuXG52YXIgcmFmID0gcmVxdWlyZSgnY29tcG9uZW50LXJhZicpXG52YXIgaXNEb20gPSByZXF1aXJlKCdpcy1kb20nKVxudmFyIHVpZCA9IHJlcXVpcmUoJ2dldC11aWQnKVxudmFyIGtleXBhdGggPSByZXF1aXJlKCdvYmplY3QtcGF0aCcpXG52YXIgZXZlbnRzID0gcmVxdWlyZSgnLi9ldmVudHMnKVxudmFyIHN2ZyA9IHJlcXVpcmUoJy4vc3ZnJylcbnZhciBkZWZhdWx0cyA9IHJlcXVpcmUoJ29iamVjdC1kZWZhdWx0cycpXG52YXIgZm9yRWFjaCA9IHJlcXVpcmUoJ2Zhc3QuanMvZm9yRWFjaCcpXG52YXIgYXNzaWduID0gcmVxdWlyZSgnZmFzdC5qcy9vYmplY3QvYXNzaWduJylcbnZhciByZWR1Y2UgPSByZXF1aXJlKCdmYXN0LmpzL3JlZHVjZScpXG52YXIgbm9kZVR5cGUgPSByZXF1aXJlKCcuL25vZGUtdHlwZScpXG5cbi8qKlxuICogRXhwb3NlIGBkb21gLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gcmVuZGVyXG5cbi8qKlxuICogUmVuZGVyIGFuIGFwcCB0byB0aGUgRE9NXG4gKlxuICogQHBhcmFtIHtBcHBsaWNhdGlvbn0gYXBwXG4gKiBAcGFyYW0ge0hUTUxFbGVtZW50fSBjb250YWluZXJcbiAqIEBwYXJhbSB7T2JqZWN0fSBvcHRzXG4gKlxuICogQHJldHVybiB7T2JqZWN0fVxuICovXG5cbmZ1bmN0aW9uIHJlbmRlciAoYXBwLCBjb250YWluZXIsIG9wdHMpIHtcbiAgdmFyIGZyYW1lSWRcbiAgdmFyIGlzUmVuZGVyaW5nXG4gIHZhciByb290SWQgPSAncm9vdCdcbiAgdmFyIGN1cnJlbnRFbGVtZW50XG4gIHZhciBjdXJyZW50TmF0aXZlRWxlbWVudFxuICB2YXIgY29ubmVjdGlvbnMgPSB7fVxuICB2YXIgY29tcG9uZW50cyA9IHt9XG4gIHZhciBlbnRpdGllcyA9IHt9XG4gIHZhciBoYW5kbGVycyA9IHt9XG4gIHZhciBtb3VudFF1ZXVlID0gW11cbiAgdmFyIGNoaWxkcmVuID0ge31cbiAgY2hpbGRyZW5bcm9vdElkXSA9IHt9XG5cbiAgaWYgKCFpc0RvbShjb250YWluZXIpKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdDb250YWluZXIgZWxlbWVudCBtdXN0IGJlIGEgRE9NIGVsZW1lbnQnKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbmRlcmluZyBvcHRpb25zLiBCYXRjaGluZyBpcyBvbmx5IGV2ZXIgcmVhbGx5IGRpc2FibGVkXG4gICAqIHdoZW4gcnVubmluZyB0ZXN0cywgYW5kIHBvb2xpbmcgY2FuIGJlIGRpc2FibGVkIGlmIHRoZSB1c2VyXG4gICAqIGlzIGRvaW5nIHNvbWV0aGluZyBzdHVwaWQgd2l0aCB0aGUgRE9NIGluIHRoZWlyIGNvbXBvbmVudHMuXG4gICAqL1xuXG4gIHZhciBvcHRpb25zID0gZGVmYXVsdHMoYXNzaWduKHt9LCBhcHAub3B0aW9ucyB8fCB7fSwgb3B0cyB8fCB7fSksIHtcbiAgICBiYXRjaGluZzogdHJ1ZVxuICB9KVxuXG4gIC8qKlxuICAgKiBMaXN0ZW4gdG8gRE9NIGV2ZW50c1xuICAgKi9cbiAgdmFyIHJvb3RFbGVtZW50ID0gZ2V0Um9vdEVsZW1lbnQoY29udGFpbmVyKVxuICBhZGROYXRpdmVFdmVudExpc3RlbmVycygpXG5cbiAgLyoqXG4gICAqIFdhdGNoIGZvciBjaGFuZ2VzIHRvIHRoZSBhcHAgc28gdGhhdCB3ZSBjYW4gdXBkYXRlXG4gICAqIHRoZSBET00gYXMgbmVlZGVkLlxuICAgKi9cblxuICBhcHAub24oJ3VubW91bnQnLCBvbnVubW91bnQpXG4gIGFwcC5vbignbW91bnQnLCBvbm1vdW50KVxuICBhcHAub24oJ3NvdXJjZScsIG9udXBkYXRlKVxuXG4gIC8qKlxuICAgKiBJZiB0aGUgYXBwIGhhcyBhbHJlYWR5IG1vdW50ZWQgYW4gZWxlbWVudCwgd2UgY2FuIGp1c3RcbiAgICogcmVuZGVyIHRoYXQgc3RyYWlnaHQgYXdheS5cbiAgICovXG5cbiAgaWYgKGFwcC5lbGVtZW50KSByZW5kZXIoKVxuXG4gIC8qKlxuICAgKiBUZWFyZG93biB0aGUgRE9NIHJlbmRlcmluZyBzbyB0aGF0IGl0IHN0b3BzXG4gICAqIHJlbmRlcmluZyBhbmQgZXZlcnl0aGluZyBjYW4gYmUgZ2FyYmFnZSBjb2xsZWN0ZWQuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHRlYXJkb3duICgpIHtcbiAgICByZW1vdmVOYXRpdmVFdmVudExpc3RlbmVycygpXG4gICAgcmVtb3ZlTmF0aXZlRWxlbWVudCgpXG4gICAgYXBwLm9mZigndW5tb3VudCcsIG9udW5tb3VudClcbiAgICBhcHAub2ZmKCdtb3VudCcsIG9ubW91bnQpXG4gICAgYXBwLm9mZignc291cmNlJywgb251cGRhdGUpXG4gIH1cblxuICAvKipcbiAgICogU3dhcCB0aGUgY3VycmVudCByZW5kZXJlZCBub2RlIHdpdGggYSBuZXcgb25lIHRoYXQgaXMgcmVuZGVyZWRcbiAgICogZnJvbSB0aGUgbmV3IHZpcnR1YWwgZWxlbWVudCBtb3VudGVkIG9uIHRoZSBhcHAuXG4gICAqXG4gICAqIEBwYXJhbSB7VmlydHVhbEVsZW1lbnR9IGVsZW1lbnRcbiAgICovXG5cbiAgZnVuY3Rpb24gb25tb3VudCAoKSB7XG4gICAgaW52YWxpZGF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogSWYgdGhlIGFwcCB1bm1vdW50cyBhbiBlbGVtZW50LCB3ZSBzaG91bGQgY2xlYXIgb3V0IHRoZSBjdXJyZW50XG4gICAqIHJlbmRlcmVkIGVsZW1lbnQuIFRoaXMgd2lsbCByZW1vdmUgYWxsIHRoZSBlbnRpdGllcy5cbiAgICovXG5cbiAgZnVuY3Rpb24gb251bm1vdW50ICgpIHtcbiAgICByZW1vdmVOYXRpdmVFbGVtZW50KClcbiAgICBjdXJyZW50RWxlbWVudCA9IG51bGxcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgYWxsIGNvbXBvbmVudHMgdGhhdCBhcmUgYm91bmQgdG8gdGhlIHNvdXJjZVxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZVxuICAgKiBAcGFyYW0geyp9IGRhdGFcbiAgICovXG5cbiAgZnVuY3Rpb24gb251cGRhdGUgKG5hbWUsIGRhdGEpIHtcbiAgICBpZiAoIWNvbm5lY3Rpb25zW25hbWVdKSByZXR1cm47XG4gICAgY29ubmVjdGlvbnNbbmFtZV0uZm9yRWFjaChmdW5jdGlvbih1cGRhdGUpIHtcbiAgICAgIHVwZGF0ZShkYXRhKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVuZGVyIGFuZCBtb3VudCBhIGNvbXBvbmVudCB0byB0aGUgbmF0aXZlIGRvbS5cbiAgICpcbiAgICogQHBhcmFtIHtFbnRpdHl9IGVudGl0eVxuICAgKiBAcmV0dXJuIHtIVE1MRWxlbWVudH1cbiAgICovXG5cbiAgZnVuY3Rpb24gbW91bnRFbnRpdHkgKGVudGl0eSkge1xuICAgIHJlZ2lzdGVyKGVudGl0eSlcbiAgICBzZXRTb3VyY2VzKGVudGl0eSlcbiAgICBjaGlsZHJlbltlbnRpdHkuaWRdID0ge31cbiAgICBlbnRpdGllc1tlbnRpdHkuaWRdID0gZW50aXR5XG5cbiAgICAvLyBjb21taXQgaW5pdGlhbCBzdGF0ZSBhbmQgcHJvcHMuXG4gICAgY29tbWl0KGVudGl0eSlcblxuICAgIC8vIGNhbGxiYWNrIGJlZm9yZSBtb3VudGluZy5cbiAgICB0cmlnZ2VyKCdiZWZvcmVNb3VudCcsIGVudGl0eSwgW2VudGl0eS5jb250ZXh0XSlcbiAgICB0cmlnZ2VyKCdiZWZvcmVSZW5kZXInLCBlbnRpdHksIFtlbnRpdHkuY29udGV4dF0pXG5cbiAgICAvLyByZW5kZXIgdmlydHVhbCBlbGVtZW50LlxuICAgIHZhciB2aXJ0dWFsRWxlbWVudCA9IHJlbmRlckVudGl0eShlbnRpdHkpXG4gICAgLy8gY3JlYXRlIG5hdGl2ZSBlbGVtZW50LlxuICAgIHZhciBuYXRpdmVFbGVtZW50ID0gdG9OYXRpdmUoZW50aXR5LmlkLCAnMCcsIHZpcnR1YWxFbGVtZW50KVxuXG4gICAgZW50aXR5LnZpcnR1YWxFbGVtZW50ID0gdmlydHVhbEVsZW1lbnRcbiAgICBlbnRpdHkubmF0aXZlRWxlbWVudCA9IG5hdGl2ZUVsZW1lbnRcblxuICAgIC8vIEZpcmUgYWZ0ZXJSZW5kZXIgYW5kIGFmdGVyTW91bnQgaG9va3MgYXQgdGhlIGVuZFxuICAgIC8vIG9mIHRoZSByZW5kZXIgY3ljbGVcbiAgICBtb3VudFF1ZXVlLnB1c2goZW50aXR5LmlkKVxuXG4gICAgcmV0dXJuIG5hdGl2ZUVsZW1lbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmUgYSBjb21wb25lbnQgZnJvbSB0aGUgbmF0aXZlIGRvbS5cbiAgICpcbiAgICogQHBhcmFtIHtFbnRpdHl9IGVudGl0eVxuICAgKi9cblxuICBmdW5jdGlvbiB1bm1vdW50RW50aXR5IChlbnRpdHlJZCkge1xuICAgIHZhciBlbnRpdHkgPSBlbnRpdGllc1tlbnRpdHlJZF1cbiAgICBpZiAoIWVudGl0eSkgcmV0dXJuXG4gICAgdHJpZ2dlcignYmVmb3JlVW5tb3VudCcsIGVudGl0eSwgW2VudGl0eS5jb250ZXh0LCBlbnRpdHkubmF0aXZlRWxlbWVudF0pXG4gICAgdW5tb3VudENoaWxkcmVuKGVudGl0eUlkKVxuICAgIHJlbW92ZUFsbEV2ZW50cyhlbnRpdHlJZClcbiAgICB2YXIgY29tcG9uZW50RW50aXRpZXMgPSBjb21wb25lbnRzW2VudGl0eUlkXS5lbnRpdGllcztcbiAgICBkZWxldGUgY29tcG9uZW50RW50aXRpZXNbZW50aXR5SWRdXG4gICAgZGVsZXRlIGNvbXBvbmVudHNbZW50aXR5SWRdXG4gICAgZGVsZXRlIGVudGl0aWVzW2VudGl0eUlkXVxuICAgIGRlbGV0ZSBjaGlsZHJlbltlbnRpdHlJZF1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZW5kZXIgdGhlIGVudGl0eSBhbmQgbWFrZSBzdXJlIGl0IHJldHVybnMgYSBub2RlXG4gICAqXG4gICAqIEBwYXJhbSB7RW50aXR5fSBlbnRpdHlcbiAgICpcbiAgICogQHJldHVybiB7VmlydHVhbFRyZWV9XG4gICAqL1xuXG4gIGZ1bmN0aW9uIHJlbmRlckVudGl0eSAoZW50aXR5KSB7XG4gICAgdmFyIGNvbXBvbmVudCA9IGVudGl0eS5jb21wb25lbnRcbiAgICB2YXIgZm4gPSB0eXBlb2YgY29tcG9uZW50ID09PSAnZnVuY3Rpb24nID8gY29tcG9uZW50IDogY29tcG9uZW50LnJlbmRlclxuICAgIGlmICghZm4pIHRocm93IG5ldyBFcnJvcignQ29tcG9uZW50IG5lZWRzIGEgcmVuZGVyIGZ1bmN0aW9uJylcbiAgICB2YXIgcmVzdWx0ID0gZm4oZW50aXR5LmNvbnRleHQsIHNldFN0YXRlKGVudGl0eSkpXG4gICAgaWYgKCFyZXN1bHQpIHRocm93IG5ldyBFcnJvcignUmVuZGVyIGZ1bmN0aW9uIG11c3QgcmV0dXJuIGFuIGVsZW1lbnQuJylcbiAgICByZXR1cm4gcmVzdWx0XG4gIH1cblxuICAvKipcbiAgICogV2hlbmV2ZXIgc2V0U3RhdGUgb3Igc2V0UHJvcHMgaXMgY2FsbGVkLCB3ZSBtYXJrIHRoZSBlbnRpdHlcbiAgICogYXMgZGlydHkgaW4gdGhlIHJlbmRlcmVyLiBUaGlzIGxldHMgdXMgb3B0aW1pemUgdGhlIHJlLXJlbmRlcmluZ1xuICAgKiBhbmQgc2tpcCBjb21wb25lbnRzIHRoYXQgZGVmaW5pdGVseSBoYXZlbid0IGNoYW5nZWQuXG4gICAqXG4gICAqIEBwYXJhbSB7RW50aXR5fSBlbnRpdHlcbiAgICpcbiAgICogQHJldHVybiB7RnVuY3Rpb259IEEgY3VycmllZCBmdW5jdGlvbiBmb3IgdXBkYXRpbmcgdGhlIHN0YXRlIG9mIGFuIGVudGl0eVxuICAgKi9cblxuICBmdW5jdGlvbiBzZXRTdGF0ZSAoZW50aXR5KSB7XG4gICAgcmV0dXJuIGZ1bmN0aW9uIChuZXh0U3RhdGUpIHtcbiAgICAgIHVwZGF0ZUVudGl0eVN0YXRlKGVudGl0eSwgbmV4dFN0YXRlKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUZWxsIHRoZSBhcHAgaXQncyBkaXJ0eSBhbmQgbmVlZHMgdG8gcmUtcmVuZGVyLiBJZiBiYXRjaGluZyBpcyBkaXNhYmxlZFxuICAgKiB3ZSBjYW4ganVzdCB0cmlnZ2VyIGEgcmVuZGVyIGltbWVkaWF0ZWx5LCBvdGhlcndpc2Ugd2UnbGwgd2FpdCB1bnRpbFxuICAgKiB0aGUgbmV4dCBhdmFpbGFibGUgZnJhbWUuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIGludmFsaWRhdGUgKCkge1xuICAgIGlmICghb3B0aW9ucy5iYXRjaGluZykge1xuICAgICAgaWYgKCFpc1JlbmRlcmluZykgcmVuZGVyKClcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCFmcmFtZUlkKSBmcmFtZUlkID0gcmFmKHJlbmRlcilcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIHRoZSBET00uIElmIHRoZSB1cGRhdGUgZmFpbHMgd2Ugc3RvcCB0aGUgbG9vcFxuICAgKiBzbyB3ZSBkb24ndCBnZXQgZXJyb3JzIG9uIGV2ZXJ5IGZyYW1lLlxuICAgKlxuICAgKiBAYXBpIHB1YmxpY1xuICAgKi9cblxuICBmdW5jdGlvbiByZW5kZXIgKCkge1xuICAgIC8vIElmIHRoaXMgaXMgY2FsbGVkIHN5bmNocm9ub3VzbHkgd2UgbmVlZCB0b1xuICAgIC8vIGNhbmNlbCBhbnkgcGVuZGluZyBmdXR1cmUgdXBkYXRlc1xuICAgIGNsZWFyRnJhbWUoKVxuXG4gICAgLy8gSWYgdGhlIHJlbmRlcmluZyBmcm9tIHRoZSBwcmV2aW91cyBmcmFtZSBpcyBzdGlsbCBnb2luZyxcbiAgICAvLyB3ZSdsbCBqdXN0IHdhaXQgdW50aWwgdGhlIG5leHQgZnJhbWUuIElkZWFsbHkgcmVuZGVycyBzaG91bGRcbiAgICAvLyBub3QgdGFrZSBvdmVyIDE2bXMgdG8gc3RheSB3aXRoaW4gYSBzaW5nbGUgZnJhbWUsIGJ1dCB0aGlzIHNob3VsZFxuICAgIC8vIGNhdGNoIGl0IGlmIGl0IGRvZXMuXG4gICAgaWYgKGlzUmVuZGVyaW5nKSB7XG4gICAgICBmcmFtZUlkID0gcmFmKHJlbmRlcilcbiAgICAgIHJldHVyblxuICAgIH0gZWxzZSB7XG4gICAgICBpc1JlbmRlcmluZyA9IHRydWVcbiAgICB9XG5cbiAgICAvLyAxLiBJZiB0aGVyZSBpc24ndCBhIG5hdGl2ZSBlbGVtZW50IHJlbmRlcmVkIGZvciB0aGUgY3VycmVudCBtb3VudGVkIGVsZW1lbnRcbiAgICAvLyB0aGVuIHdlIG5lZWQgdG8gY3JlYXRlIGl0IGZyb20gc2NyYXRjaC5cbiAgICAvLyAyLiBJZiBhIG5ldyBlbGVtZW50IGhhcyBiZWVuIG1vdW50ZWQsIHdlIHNob3VsZCBkaWZmIHRoZW0uXG4gICAgLy8gMy4gV2Ugc2hvdWxkIHVwZGF0ZSBjaGVjayBhbGwgY2hpbGQgY29tcG9uZW50cyBmb3IgY2hhbmdlcy5cbiAgICBpZiAoIWN1cnJlbnROYXRpdmVFbGVtZW50KSB7XG4gICAgICBjdXJyZW50RWxlbWVudCA9IGFwcC5lbGVtZW50XG4gICAgICBjdXJyZW50TmF0aXZlRWxlbWVudCA9IHRvTmF0aXZlKHJvb3RJZCwgJzAnLCBjdXJyZW50RWxlbWVudClcbiAgICAgIGlmIChjb250YWluZXIuY2hpbGRyZW4ubGVuZ3RoID4gMCkge1xuICAgICAgICBjb25zb2xlLmluZm8oJ2Rla3U6IFRoZSBjb250YWluZXIgZWxlbWVudCBpcyBub3QgZW1wdHkuIFRoZXNlIGVsZW1lbnRzIHdpbGwgYmUgcmVtb3ZlZC4gUmVhZCBtb3JlOiBodHRwOi8vY2wubHkvYjBTcicpXG4gICAgICB9XG4gICAgICBpZiAoY29udGFpbmVyID09PSBkb2N1bWVudC5ib2R5KSB7XG4gICAgICAgIGNvbnNvbGUud2FybignZGVrdTogVXNpbmcgZG9jdW1lbnQuYm9keSBpcyBhbGxvd2VkIGJ1dCBpdCBjYW4gY2F1c2Ugc29tZSBpc3N1ZXMuIFJlYWQgbW9yZTogaHR0cDovL2NsLmx5L2IwU0MnKVxuICAgICAgfVxuICAgICAgcmVtb3ZlQWxsQ2hpbGRyZW4oY29udGFpbmVyKVxuICAgICAgY29udGFpbmVyLmFwcGVuZENoaWxkKGN1cnJlbnROYXRpdmVFbGVtZW50KVxuICAgIH0gZWxzZSBpZiAoY3VycmVudEVsZW1lbnQgIT09IGFwcC5lbGVtZW50KSB7XG4gICAgICBjdXJyZW50TmF0aXZlRWxlbWVudCA9IHBhdGNoKHJvb3RJZCwgY3VycmVudEVsZW1lbnQsIGFwcC5lbGVtZW50LCBjdXJyZW50TmF0aXZlRWxlbWVudClcbiAgICAgIGN1cnJlbnRFbGVtZW50ID0gYXBwLmVsZW1lbnRcbiAgICAgIHVwZGF0ZUNoaWxkcmVuKHJvb3RJZClcbiAgICB9IGVsc2Uge1xuICAgICAgdXBkYXRlQ2hpbGRyZW4ocm9vdElkKVxuICAgIH1cblxuICAgIC8vIENhbGwgbW91bnQgZXZlbnRzIG9uIGFsbCBuZXcgZW50aXRpZXNcbiAgICBmbHVzaE1vdW50UXVldWUoKVxuXG4gICAgLy8gQWxsb3cgcmVuZGVyaW5nIGFnYWluLlxuICAgIGlzUmVuZGVyaW5nID0gZmFsc2VcblxuICB9XG5cbiAgLyoqXG4gICAqIENhbGwgaG9va3MgZm9yIGFsbCBuZXcgZW50aXRpZXMgdGhhdCBoYXZlIGJlZW4gY3JlYXRlZCBpblxuICAgKiB0aGUgbGFzdCByZW5kZXIgZnJvbSB0aGUgYm90dG9tIHVwLlxuICAgKi9cblxuICBmdW5jdGlvbiBmbHVzaE1vdW50UXVldWUgKCkge1xuICAgIHdoaWxlIChtb3VudFF1ZXVlLmxlbmd0aCA+IDApIHtcbiAgICAgIHZhciBlbnRpdHlJZCA9IG1vdW50UXVldWUuc2hpZnQoKVxuICAgICAgdmFyIGVudGl0eSA9IGVudGl0aWVzW2VudGl0eUlkXVxuICAgICAgdHJpZ2dlcignYWZ0ZXJSZW5kZXInLCBlbnRpdHksIFtlbnRpdHkuY29udGV4dCwgZW50aXR5Lm5hdGl2ZUVsZW1lbnRdKVxuICAgICAgdHJpZ2dlcignYWZ0ZXJNb3VudCcsIGVudGl0eSwgW2VudGl0eS5jb250ZXh0LCBlbnRpdHkubmF0aXZlRWxlbWVudCwgc2V0U3RhdGUoZW50aXR5KV0pXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENsZWFyIHRoZSBjdXJyZW50IHNjaGVkdWxlZCBmcmFtZVxuICAgKi9cblxuICBmdW5jdGlvbiBjbGVhckZyYW1lICgpIHtcbiAgICBpZiAoIWZyYW1lSWQpIHJldHVyblxuICAgIHJhZi5jYW5jZWwoZnJhbWVJZClcbiAgICBmcmFtZUlkID0gMFxuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBhIGNvbXBvbmVudC5cbiAgICpcbiAgICogVGhlIGVudGl0eSBpcyBqdXN0IHRoZSBkYXRhIG9iamVjdCBmb3IgYSBjb21wb25lbnQgaW5zdGFuY2UuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBpZCBDb21wb25lbnQgaW5zdGFuY2UgaWQuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHVwZGF0ZUVudGl0eSAoZW50aXR5SWQpIHtcbiAgICB2YXIgZW50aXR5ID0gZW50aXRpZXNbZW50aXR5SWRdXG4gICAgc2V0U291cmNlcyhlbnRpdHkpXG5cbiAgICBpZiAoIXNob3VsZFVwZGF0ZShlbnRpdHkpKSB7XG4gICAgICBjb21taXQoZW50aXR5KVxuICAgICAgcmV0dXJuIHVwZGF0ZUNoaWxkcmVuKGVudGl0eUlkKVxuICAgIH1cblxuICAgIHZhciBjdXJyZW50VHJlZSA9IGVudGl0eS52aXJ0dWFsRWxlbWVudFxuICAgIHZhciBuZXh0UHJvcHMgPSBlbnRpdHkucGVuZGluZ1Byb3BzXG4gICAgdmFyIG5leHRTdGF0ZSA9IGVudGl0eS5wZW5kaW5nU3RhdGVcbiAgICB2YXIgcHJldmlvdXNTdGF0ZSA9IGVudGl0eS5jb250ZXh0LnN0YXRlXG4gICAgdmFyIHByZXZpb3VzUHJvcHMgPSBlbnRpdHkuY29udGV4dC5wcm9wc1xuXG4gICAgLy8gaG9vayBiZWZvcmUgcmVuZGVyaW5nLiBjb3VsZCBtb2RpZnkgc3RhdGUganVzdCBiZWZvcmUgdGhlIHJlbmRlciBvY2N1cnMuXG4gICAgdHJpZ2dlcignYmVmb3JlVXBkYXRlJywgZW50aXR5LCBbZW50aXR5LmNvbnRleHQsIG5leHRQcm9wcywgbmV4dFN0YXRlXSlcbiAgICB0cmlnZ2VyKCdiZWZvcmVSZW5kZXInLCBlbnRpdHksIFtlbnRpdHkuY29udGV4dF0pXG5cbiAgICAvLyBjb21taXQgc3RhdGUgYW5kIHByb3BzLlxuICAgIGNvbW1pdChlbnRpdHkpXG5cbiAgICAvLyByZS1yZW5kZXIuXG4gICAgdmFyIG5leHRUcmVlID0gcmVuZGVyRW50aXR5KGVudGl0eSlcblxuICAgIC8vIGlmIHRoZSB0cmVlIGlzIHRoZSBzYW1lIHdlIGNhbiBqdXN0IHNraXAgdGhpcyBjb21wb25lbnRcbiAgICAvLyBidXQgd2Ugc2hvdWxkIHN0aWxsIGNoZWNrIHRoZSBjaGlsZHJlbiB0byBzZWUgaWYgdGhleSdyZSBkaXJ0eS5cbiAgICAvLyBUaGlzIGFsbG93cyB1cyB0byBtZW1vaXplIHRoZSByZW5kZXIgZnVuY3Rpb24gb2YgY29tcG9uZW50cy5cbiAgICBpZiAobmV4dFRyZWUgPT09IGN1cnJlbnRUcmVlKSByZXR1cm4gdXBkYXRlQ2hpbGRyZW4oZW50aXR5SWQpXG5cbiAgICAvLyBhcHBseSBuZXcgdmlydHVhbCB0cmVlIHRvIG5hdGl2ZSBkb20uXG4gICAgZW50aXR5Lm5hdGl2ZUVsZW1lbnQgPSBwYXRjaChlbnRpdHlJZCwgY3VycmVudFRyZWUsIG5leHRUcmVlLCBlbnRpdHkubmF0aXZlRWxlbWVudClcbiAgICBlbnRpdHkudmlydHVhbEVsZW1lbnQgPSBuZXh0VHJlZVxuICAgIHVwZGF0ZUNoaWxkcmVuKGVudGl0eUlkKVxuXG4gICAgLy8gdHJpZ2dlciByZW5kZXIgaG9va1xuICAgIHRyaWdnZXIoJ2FmdGVyUmVuZGVyJywgZW50aXR5LCBbZW50aXR5LmNvbnRleHQsIGVudGl0eS5uYXRpdmVFbGVtZW50XSlcblxuICAgIC8vIHRyaWdnZXIgYWZ0ZXJVcGRhdGUgYWZ0ZXIgYWxsIGNoaWxkcmVuIGhhdmUgdXBkYXRlZC5cbiAgICB0cmlnZ2VyKCdhZnRlclVwZGF0ZScsIGVudGl0eSwgW2VudGl0eS5jb250ZXh0LCBwcmV2aW91c1Byb3BzLCBwcmV2aW91c1N0YXRlLCBzZXRTdGF0ZShlbnRpdHkpXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgYWxsIHRoZSBjaGlsZHJlbiBvZiBhbiBlbnRpdHkuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBpZCBDb21wb25lbnQgaW5zdGFuY2UgaWQuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHVwZGF0ZUNoaWxkcmVuIChlbnRpdHlJZCkge1xuICAgIGZvckVhY2goY2hpbGRyZW5bZW50aXR5SWRdLCBmdW5jdGlvbiAoY2hpbGRJZCkge1xuICAgICAgdXBkYXRlRW50aXR5KGNoaWxkSWQpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmUgYWxsIG9mIHRoZSBjaGlsZCBlbnRpdGllcyBvZiBhbiBlbnRpdHlcbiAgICpcbiAgICogQHBhcmFtIHtFbnRpdHl9IGVudGl0eVxuICAgKi9cblxuICBmdW5jdGlvbiB1bm1vdW50Q2hpbGRyZW4gKGVudGl0eUlkKSB7XG4gICAgZm9yRWFjaChjaGlsZHJlbltlbnRpdHlJZF0sIGZ1bmN0aW9uIChjaGlsZElkKSB7XG4gICAgICB1bm1vdW50RW50aXR5KGNoaWxkSWQpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmUgdGhlIHJvb3QgZWxlbWVudC4gSWYgdGhpcyBpcyBjYWxsZWQgc3luY2hyb25vdXNseSB3ZSBuZWVkIHRvXG4gICAqIGNhbmNlbCBhbnkgcGVuZGluZyBmdXR1cmUgdXBkYXRlcy5cbiAgICovXG5cbiAgZnVuY3Rpb24gcmVtb3ZlTmF0aXZlRWxlbWVudCAoKSB7XG4gICAgY2xlYXJGcmFtZSgpXG4gICAgcmVtb3ZlRWxlbWVudChyb290SWQsICcwJywgY3VycmVudE5hdGl2ZUVsZW1lbnQpXG4gICAgY3VycmVudE5hdGl2ZUVsZW1lbnQgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgbmF0aXZlIGVsZW1lbnQgZnJvbSBhIHZpcnR1YWwgZWxlbWVudC5cbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGVudGl0eUlkXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoXG4gICAqIEBwYXJhbSB7T2JqZWN0fSB2bm9kZVxuICAgKlxuICAgKiBAcmV0dXJuIHtIVE1MRG9jdW1lbnRGcmFnbWVudH1cbiAgICovXG5cbiAgZnVuY3Rpb24gdG9OYXRpdmUgKGVudGl0eUlkLCBwYXRoLCB2bm9kZSkge1xuICAgIHN3aXRjaCAobm9kZVR5cGUodm5vZGUpKSB7XG4gICAgICBjYXNlICd0ZXh0JzogcmV0dXJuIHRvTmF0aXZlVGV4dCh2bm9kZSlcbiAgICAgIGNhc2UgJ2VtcHR5JzogcmV0dXJuIHRvTmF0aXZlRW1wdHlFbGVtZW50KGVudGl0eUlkLCBwYXRoKVxuICAgICAgY2FzZSAnZWxlbWVudCc6IHJldHVybiB0b05hdGl2ZUVsZW1lbnQoZW50aXR5SWQsIHBhdGgsIHZub2RlKVxuICAgICAgY2FzZSAnY29tcG9uZW50JzogcmV0dXJuIHRvTmF0aXZlQ29tcG9uZW50KGVudGl0eUlkLCBwYXRoLCB2bm9kZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgbmF0aXZlIHRleHQgZWxlbWVudCBmcm9tIGEgdmlydHVhbCBlbGVtZW50LlxuICAgKlxuICAgKiBAcGFyYW0ge09iamVjdH0gdm5vZGVcbiAgICovXG5cbiAgZnVuY3Rpb24gdG9OYXRpdmVUZXh0ICh0ZXh0KSB7XG4gICAgcmV0dXJuIGRvY3VtZW50LmNyZWF0ZVRleHROb2RlKHRleHQpXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgbmF0aXZlIGVsZW1lbnQgZnJvbSBhIHZpcnR1YWwgZWxlbWVudC5cbiAgICovXG5cbiAgZnVuY3Rpb24gdG9OYXRpdmVFbGVtZW50IChlbnRpdHlJZCwgcGF0aCwgdm5vZGUpIHtcbiAgICB2YXIgZWxcbiAgICB2YXIgYXR0cmlidXRlcyA9IHZub2RlLmF0dHJpYnV0ZXNcbiAgICB2YXIgdGFnTmFtZSA9IHZub2RlLnR5cGVcbiAgICB2YXIgY2hpbGROb2RlcyA9IHZub2RlLmNoaWxkcmVuXG5cbiAgICAvLyBjcmVhdGUgZWxlbWVudCBlaXRoZXIgZnJvbSBwb29sIG9yIGZyZXNoLlxuICAgIGlmIChzdmcuaXNFbGVtZW50KHRhZ05hbWUpKSB7XG4gICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnROUyhzdmcubmFtZXNwYWNlLCB0YWdOYW1lKVxuICAgIH0gZWxzZSB7XG4gICAgICBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQodGFnTmFtZSlcbiAgICB9XG5cbiAgICAvLyBzZXQgYXR0cmlidXRlcy5cbiAgICBmb3JFYWNoKGF0dHJpYnV0ZXMsIGZ1bmN0aW9uICh2YWx1ZSwgbmFtZSkge1xuICAgICAgc2V0QXR0cmlidXRlKGVudGl0eUlkLCBwYXRoLCBlbCwgbmFtZSwgdmFsdWUpXG4gICAgfSlcblxuICAgIC8vIGFkZCBjaGlsZHJlbi5cbiAgICBmb3JFYWNoKGNoaWxkTm9kZXMsIGZ1bmN0aW9uIChjaGlsZCwgaSkge1xuICAgICAgdmFyIGNoaWxkRWwgPSB0b05hdGl2ZShlbnRpdHlJZCwgcGF0aCArICcuJyArIGksIGNoaWxkKVxuICAgICAgaWYgKCFjaGlsZEVsLnBhcmVudE5vZGUpIGVsLmFwcGVuZENoaWxkKGNoaWxkRWwpXG4gICAgfSlcblxuICAgIC8vIHN0b3JlIGtleXMgb24gdGhlIG5hdGl2ZSBlbGVtZW50IGZvciBmYXN0IGV2ZW50IGhhbmRsaW5nLlxuICAgIGVsLl9fZW50aXR5X18gPSBlbnRpdHlJZFxuICAgIGVsLl9fcGF0aF9fID0gcGF0aFxuXG4gICAgcmV0dXJuIGVsXG4gIH1cblxuICAvKipcbiAgICogQ3JlYXRlIGEgbmF0aXZlIGVsZW1lbnQgZnJvbSBhIHZpcnR1YWwgZWxlbWVudC5cbiAgICovXG5cbiAgZnVuY3Rpb24gdG9OYXRpdmVFbXB0eUVsZW1lbnQgKGVudGl0eUlkLCBwYXRoKSB7XG4gICAgdmFyIGVsID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnbm9zY3JpcHQnKVxuICAgIGVsLl9fZW50aXR5X18gPSBlbnRpdHlJZFxuICAgIGVsLl9fcGF0aF9fID0gcGF0aFxuICAgIHJldHVybiBlbFxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIG5hdGl2ZSBlbGVtZW50IGZyb20gYSBjb21wb25lbnQuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHRvTmF0aXZlQ29tcG9uZW50IChlbnRpdHlJZCwgcGF0aCwgdm5vZGUpIHtcbiAgICB2YXIgY2hpbGQgPSBuZXcgRW50aXR5KHZub2RlLnR5cGUsIGFzc2lnbih7IGNoaWxkcmVuOiB2bm9kZS5jaGlsZHJlbiB9LCB2bm9kZS5hdHRyaWJ1dGVzKSwgZW50aXR5SWQpXG4gICAgY2hpbGRyZW5bZW50aXR5SWRdW3BhdGhdID0gY2hpbGQuaWRcbiAgICByZXR1cm4gbW91bnRFbnRpdHkoY2hpbGQpXG4gIH1cblxuICAvKipcbiAgICogUGF0Y2ggYW4gZWxlbWVudCB3aXRoIHRoZSBkaWZmIGZyb20gdHdvIHRyZWVzLlxuICAgKi9cblxuICBmdW5jdGlvbiBwYXRjaCAoZW50aXR5SWQsIHByZXYsIG5leHQsIGVsKSB7XG4gICAgcmV0dXJuIGRpZmZOb2RlKCcwJywgZW50aXR5SWQsIHByZXYsIG5leHQsIGVsKVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIGRpZmYgYmV0d2VlbiB0d28gdHJlZXMgb2Ygbm9kZXMuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIGRpZmZOb2RlIChwYXRoLCBlbnRpdHlJZCwgcHJldiwgbmV4dCwgZWwpIHtcbiAgICB2YXIgbGVmdFR5cGUgPSBub2RlVHlwZShwcmV2KVxuICAgIHZhciByaWdodFR5cGUgPSBub2RlVHlwZShuZXh0KVxuXG4gICAgLy8gVHlwZSBjaGFuZ2VkLiBUaGlzIGNvdWxkIGJlIGZyb20gZWxlbWVudC0+dGV4dCwgdGV4dC0+Q29tcG9uZW50QSxcbiAgICAvLyBDb21wb25lbnRBLT5Db21wb25lbnRCIGV0Yy4gQnV0IE5PVCBkaXYtPnNwYW4uIFRoZXNlIGFyZSB0aGUgc2FtZSB0eXBlXG4gICAgLy8gKEVsZW1lbnROb2RlKSBidXQgZGlmZmVyZW50IHRhZyBuYW1lLlxuICAgIGlmIChsZWZ0VHlwZSAhPT0gcmlnaHRUeXBlKSByZXR1cm4gcmVwbGFjZUVsZW1lbnQoZW50aXR5SWQsIHBhdGgsIGVsLCBuZXh0KVxuXG4gICAgc3dpdGNoIChyaWdodFR5cGUpIHtcbiAgICAgIGNhc2UgJ3RleHQnOiByZXR1cm4gZGlmZlRleHQocHJldiwgbmV4dCwgZWwpXG4gICAgICBjYXNlICdlbXB0eSc6IHJldHVybiBlbFxuICAgICAgY2FzZSAnZWxlbWVudCc6IHJldHVybiBkaWZmRWxlbWVudChwYXRoLCBlbnRpdHlJZCwgcHJldiwgbmV4dCwgZWwpXG4gICAgICBjYXNlICdjb21wb25lbnQnOiByZXR1cm4gZGlmZkNvbXBvbmVudChwYXRoLCBlbnRpdHlJZCwgcHJldiwgbmV4dCwgZWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIERpZmYgdHdvIHRleHQgbm9kZXMgYW5kIHVwZGF0ZSB0aGUgZWxlbWVudC5cbiAgICovXG5cbiAgZnVuY3Rpb24gZGlmZlRleHQgKHByZXZpb3VzLCBjdXJyZW50LCBlbCkge1xuICAgIGlmIChjdXJyZW50ICE9PSBwcmV2aW91cykgZWwuZGF0YSA9IGN1cnJlbnRcbiAgICByZXR1cm4gZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBEaWZmIHRoZSBjaGlsZHJlbiBvZiBhbiBFbGVtZW50Tm9kZS5cbiAgICovXG5cbiAgZnVuY3Rpb24gZGlmZkNoaWxkcmVuIChwYXRoLCBlbnRpdHlJZCwgcHJldiwgbmV4dCwgZWwpIHtcbiAgICB2YXIgcG9zaXRpb25zID0gW11cbiAgICB2YXIgaGFzS2V5cyA9IGZhbHNlXG4gICAgdmFyIGNoaWxkTm9kZXMgPSBBcnJheS5wcm90b3R5cGUuc2xpY2UuYXBwbHkoZWwuY2hpbGROb2RlcylcbiAgICB2YXIgbGVmdEtleXMgPSByZWR1Y2UocHJldi5jaGlsZHJlbiwga2V5TWFwUmVkdWNlciwge30pXG4gICAgdmFyIHJpZ2h0S2V5cyA9IHJlZHVjZShuZXh0LmNoaWxkcmVuLCBrZXlNYXBSZWR1Y2VyLCB7fSlcbiAgICB2YXIgY3VycmVudENoaWxkcmVuID0gYXNzaWduKHt9LCBjaGlsZHJlbltlbnRpdHlJZF0pXG5cbiAgICBmdW5jdGlvbiBrZXlNYXBSZWR1Y2VyIChhY2MsIGNoaWxkLCBpKSB7XG4gICAgICBpZiAoY2hpbGQgJiYgY2hpbGQuYXR0cmlidXRlcyAmJiBjaGlsZC5hdHRyaWJ1dGVzLmtleSAhPSBudWxsKSB7XG4gICAgICAgIGFjY1tjaGlsZC5hdHRyaWJ1dGVzLmtleV0gPSB7XG4gICAgICAgICAgZWxlbWVudDogY2hpbGQsXG4gICAgICAgICAgaW5kZXg6IGlcbiAgICAgICAgfVxuICAgICAgICBoYXNLZXlzID0gdHJ1ZVxuICAgICAgfVxuICAgICAgcmV0dXJuIGFjY1xuICAgIH1cblxuICAgIC8vIERpZmYgYWxsIG9mIHRoZSBub2RlcyB0aGF0IGhhdmUga2V5cy4gVGhpcyBsZXRzIHVzIHJlLXVzZWQgZWxlbWVudHNcbiAgICAvLyBpbnN0ZWFkIG9mIG92ZXJyaWRpbmcgdGhlbSBhbmQgbGV0cyB1cyBtb3ZlIHRoZW0gYXJvdW5kLlxuICAgIGlmIChoYXNLZXlzKSB7XG5cbiAgICAgIC8vIFJlbW92YWxzXG4gICAgICBmb3JFYWNoKGxlZnRLZXlzLCBmdW5jdGlvbiAobGVmdE5vZGUsIGtleSkge1xuICAgICAgICBpZiAocmlnaHRLZXlzW2tleV0gPT0gbnVsbCkge1xuICAgICAgICAgIHZhciBsZWZ0UGF0aCA9IHBhdGggKyAnLicgKyBsZWZ0Tm9kZS5pbmRleFxuICAgICAgICAgIHJlbW92ZUVsZW1lbnQoXG4gICAgICAgICAgICBlbnRpdHlJZCxcbiAgICAgICAgICAgIGxlZnRQYXRoLFxuICAgICAgICAgICAgY2hpbGROb2Rlc1tsZWZ0Tm9kZS5pbmRleF1cbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIC8vIFVwZGF0ZSBub2Rlc1xuICAgICAgZm9yRWFjaChyaWdodEtleXMsIGZ1bmN0aW9uIChyaWdodE5vZGUsIGtleSkge1xuICAgICAgICB2YXIgbGVmdE5vZGUgPSBsZWZ0S2V5c1trZXldXG5cbiAgICAgICAgLy8gV2Ugb25seSB3YW50IHVwZGF0ZXMgZm9yIG5vd1xuICAgICAgICBpZiAobGVmdE5vZGUgPT0gbnVsbCkgcmV0dXJuXG5cbiAgICAgICAgdmFyIGxlZnRQYXRoID0gcGF0aCArICcuJyArIGxlZnROb2RlLmluZGV4XG5cbiAgICAgICAgLy8gVXBkYXRlZFxuICAgICAgICBwb3NpdGlvbnNbcmlnaHROb2RlLmluZGV4XSA9IGRpZmZOb2RlKFxuICAgICAgICAgIGxlZnRQYXRoLFxuICAgICAgICAgIGVudGl0eUlkLFxuICAgICAgICAgIGxlZnROb2RlLmVsZW1lbnQsXG4gICAgICAgICAgcmlnaHROb2RlLmVsZW1lbnQsXG4gICAgICAgICAgY2hpbGROb2Rlc1tsZWZ0Tm9kZS5pbmRleF1cbiAgICAgICAgKVxuICAgICAgfSlcblxuICAgICAgLy8gVXBkYXRlIHRoZSBwb3NpdGlvbnMgb2YgYWxsIGNoaWxkIGNvbXBvbmVudHMgYW5kIGV2ZW50IGhhbmRsZXJzXG4gICAgICBmb3JFYWNoKHJpZ2h0S2V5cywgZnVuY3Rpb24gKHJpZ2h0Tm9kZSwga2V5KSB7XG4gICAgICAgIHZhciBsZWZ0Tm9kZSA9IGxlZnRLZXlzW2tleV1cblxuICAgICAgICAvLyBXZSBqdXN0IHdhbnQgZWxlbWVudHMgdGhhdCBoYXZlIG1vdmVkIGFyb3VuZFxuICAgICAgICBpZiAobGVmdE5vZGUgPT0gbnVsbCB8fCBsZWZ0Tm9kZS5pbmRleCA9PT0gcmlnaHROb2RlLmluZGV4KSByZXR1cm5cblxuICAgICAgICB2YXIgcmlnaHRQYXRoID0gcGF0aCArICcuJyArIHJpZ2h0Tm9kZS5pbmRleFxuICAgICAgICB2YXIgbGVmdFBhdGggPSBwYXRoICsgJy4nICsgbGVmdE5vZGUuaW5kZXhcblxuICAgICAgICAvLyBVcGRhdGUgYWxsIHRoZSBjaGlsZCBjb21wb25lbnQgcGF0aCBwb3NpdGlvbnMgdG8gbWF0Y2hcbiAgICAgICAgLy8gdGhlIGxhdGVzdCBwb3NpdGlvbnMgaWYgdGhleSd2ZSBjaGFuZ2VkLiBUaGlzIGlzIGEgYml0IGhhY2t5LlxuICAgICAgICBmb3JFYWNoKGN1cnJlbnRDaGlsZHJlbiwgZnVuY3Rpb24gKGNoaWxkSWQsIGNoaWxkUGF0aCkge1xuICAgICAgICAgIGlmIChsZWZ0UGF0aCA9PT0gY2hpbGRQYXRoKSB7XG4gICAgICAgICAgICBkZWxldGUgY2hpbGRyZW5bZW50aXR5SWRdW2NoaWxkUGF0aF1cbiAgICAgICAgICAgIGNoaWxkcmVuW2VudGl0eUlkXVtyaWdodFBhdGhdID0gY2hpbGRJZFxuICAgICAgICAgIH1cbiAgICAgICAgfSlcbiAgICAgIH0pXG5cbiAgICAgIC8vIE5vdyBhZGQgYWxsIG9mIHRoZSBuZXcgbm9kZXMgbGFzdCBpbiBjYXNlIHRoZWlyIHBhdGhcbiAgICAgIC8vIHdvdWxkIGhhdmUgY29uZmxpY3RlZCB3aXRoIG9uZSBvZiB0aGUgcHJldmlvdXMgcGF0aHMuXG4gICAgICBmb3JFYWNoKHJpZ2h0S2V5cywgZnVuY3Rpb24gKHJpZ2h0Tm9kZSwga2V5KSB7XG4gICAgICAgIHZhciByaWdodFBhdGggPSBwYXRoICsgJy4nICsgcmlnaHROb2RlLmluZGV4XG4gICAgICAgIGlmIChsZWZ0S2V5c1trZXldID09IG51bGwpIHtcbiAgICAgICAgICBwb3NpdGlvbnNbcmlnaHROb2RlLmluZGV4XSA9IHRvTmF0aXZlKFxuICAgICAgICAgICAgZW50aXR5SWQsXG4gICAgICAgICAgICByaWdodFBhdGgsXG4gICAgICAgICAgICByaWdodE5vZGUuZWxlbWVudFxuICAgICAgICAgIClcbiAgICAgICAgfVxuICAgICAgfSlcblxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgbWF4TGVuZ3RoID0gTWF0aC5tYXgocHJldi5jaGlsZHJlbi5sZW5ndGgsIG5leHQuY2hpbGRyZW4ubGVuZ3RoKVxuXG4gICAgICAvLyBOb3cgZGlmZiBhbGwgb2YgdGhlIG5vZGVzIHRoYXQgZG9uJ3QgaGF2ZSBrZXlzXG4gICAgICBmb3IgKHZhciBpID0gMDsgaSA8IG1heExlbmd0aDsgaSsrKSB7XG4gICAgICAgIHZhciBsZWZ0Tm9kZSA9IHByZXYuY2hpbGRyZW5baV1cbiAgICAgICAgdmFyIHJpZ2h0Tm9kZSA9IG5leHQuY2hpbGRyZW5baV1cblxuICAgICAgICAvLyBSZW1vdmFsc1xuICAgICAgICBpZiAocmlnaHROb2RlID09PSB1bmRlZmluZWQpIHtcbiAgICAgICAgICByZW1vdmVFbGVtZW50KFxuICAgICAgICAgICAgZW50aXR5SWQsXG4gICAgICAgICAgICBwYXRoICsgJy4nICsgaSxcbiAgICAgICAgICAgIGNoaWxkTm9kZXNbaV1cbiAgICAgICAgICApXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIE5ldyBOb2RlXG4gICAgICAgIGlmIChsZWZ0Tm9kZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgcG9zaXRpb25zW2ldID0gdG9OYXRpdmUoXG4gICAgICAgICAgICBlbnRpdHlJZCxcbiAgICAgICAgICAgIHBhdGggKyAnLicgKyBpLFxuICAgICAgICAgICAgcmlnaHROb2RlXG4gICAgICAgICAgKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICAvLyBVcGRhdGVkXG4gICAgICAgIHBvc2l0aW9uc1tpXSA9IGRpZmZOb2RlKFxuICAgICAgICAgIHBhdGggKyAnLicgKyBpLFxuICAgICAgICAgIGVudGl0eUlkLFxuICAgICAgICAgIGxlZnROb2RlLFxuICAgICAgICAgIHJpZ2h0Tm9kZSxcbiAgICAgICAgICBjaGlsZE5vZGVzW2ldXG4gICAgICAgIClcbiAgICAgIH1cbiAgICB9XG5cbiAgICAvLyBSZXBvc2l0aW9uIGFsbCB0aGUgZWxlbWVudHNcbiAgICBmb3JFYWNoKHBvc2l0aW9ucywgZnVuY3Rpb24gKGNoaWxkRWwsIG5ld1Bvc2l0aW9uKSB7XG4gICAgICB2YXIgdGFyZ2V0ID0gZWwuY2hpbGROb2Rlc1tuZXdQb3NpdGlvbl1cbiAgICAgIGlmIChjaGlsZEVsICYmIGNoaWxkRWwgIT09IHRhcmdldCkge1xuICAgICAgICBpZiAodGFyZ2V0KSB7XG4gICAgICAgICAgZWwuaW5zZXJ0QmVmb3JlKGNoaWxkRWwsIHRhcmdldClcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBlbC5hcHBlbmRDaGlsZChjaGlsZEVsKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBEaWZmIHRoZSBhdHRyaWJ1dGVzIGFuZCBhZGQvcmVtb3ZlIHRoZW0uXG4gICAqL1xuXG4gIGZ1bmN0aW9uIGRpZmZBdHRyaWJ1dGVzIChwcmV2LCBuZXh0LCBlbCwgZW50aXR5SWQsIHBhdGgpIHtcbiAgICB2YXIgbmV4dEF0dHJzID0gbmV4dC5hdHRyaWJ1dGVzXG4gICAgdmFyIHByZXZBdHRycyA9IHByZXYuYXR0cmlidXRlc1xuXG4gICAgLy8gYWRkIG5ldyBhdHRyc1xuICAgIGZvckVhY2gobmV4dEF0dHJzLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgIGlmIChldmVudHNbbmFtZV0gfHwgIShuYW1lIGluIHByZXZBdHRycykgfHwgcHJldkF0dHJzW25hbWVdICE9PSB2YWx1ZSkge1xuICAgICAgICBzZXRBdHRyaWJ1dGUoZW50aXR5SWQsIHBhdGgsIGVsLCBuYW1lLCB2YWx1ZSlcbiAgICAgIH1cbiAgICB9KVxuXG4gICAgLy8gcmVtb3ZlIG9sZCBhdHRyc1xuICAgIGZvckVhY2gocHJldkF0dHJzLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgIGlmICghKG5hbWUgaW4gbmV4dEF0dHJzKSkge1xuICAgICAgICByZW1vdmVBdHRyaWJ1dGUoZW50aXR5SWQsIHBhdGgsIGVsLCBuYW1lKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGEgY29tcG9uZW50IHdpdGggdGhlIHByb3BzIGZyb20gdGhlIG5leHQgbm9kZS4gSWZcbiAgICogdGhlIGNvbXBvbmVudCB0eXBlIGhhcyBjaGFuZ2VkLCB3ZSdsbCBqdXN0IHJlbW92ZSB0aGUgb2xkIG9uZVxuICAgKiBhbmQgcmVwbGFjZSBpdCB3aXRoIHRoZSBuZXcgY29tcG9uZW50LlxuICAgKi9cblxuICBmdW5jdGlvbiBkaWZmQ29tcG9uZW50IChwYXRoLCBlbnRpdHlJZCwgcHJldiwgbmV4dCwgZWwpIHtcbiAgICBpZiAobmV4dC50eXBlICE9PSBwcmV2LnR5cGUpIHtcbiAgICAgIHJldHVybiByZXBsYWNlRWxlbWVudChlbnRpdHlJZCwgcGF0aCwgZWwsIG5leHQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciB0YXJnZXRJZCA9IGNoaWxkcmVuW2VudGl0eUlkXVtwYXRoXVxuXG4gICAgICAvLyBUaGlzIGlzIGEgaGFjayBmb3Igbm93XG4gICAgICBpZiAodGFyZ2V0SWQpIHtcbiAgICAgICAgdXBkYXRlRW50aXR5UHJvcHModGFyZ2V0SWQsIGFzc2lnbih7IGNoaWxkcmVuOiBuZXh0LmNoaWxkcmVuIH0sIG5leHQuYXR0cmlidXRlcykpXG4gICAgICB9XG5cbiAgICAgIHJldHVybiBlbFxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEaWZmIHR3byBlbGVtZW50IG5vZGVzLlxuICAgKi9cblxuICBmdW5jdGlvbiBkaWZmRWxlbWVudCAocGF0aCwgZW50aXR5SWQsIHByZXYsIG5leHQsIGVsKSB7XG4gICAgaWYgKG5leHQudHlwZSAhPT0gcHJldi50eXBlKSByZXR1cm4gcmVwbGFjZUVsZW1lbnQoZW50aXR5SWQsIHBhdGgsIGVsLCBuZXh0KVxuICAgIGRpZmZBdHRyaWJ1dGVzKHByZXYsIG5leHQsIGVsLCBlbnRpdHlJZCwgcGF0aClcbiAgICBkaWZmQ2hpbGRyZW4ocGF0aCwgZW50aXR5SWQsIHByZXYsIG5leHQsIGVsKVxuICAgIHJldHVybiBlbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYW4gZWxlbWVudCBmcm9tIHRoZSBET00gYW5kIHVubW91bnRzIGFuZCBjb21wb25lbnRzXG4gICAqIHRoYXQgYXJlIHdpdGhpbiB0aGF0IGJyYW5jaFxuICAgKlxuICAgKiBzaWRlIGVmZmVjdHM6XG4gICAqICAgLSByZW1vdmVzIGVsZW1lbnQgZnJvbSB0aGUgRE9NXG4gICAqICAgLSByZW1vdmVzIGludGVybmFsIHJlZmVyZW5jZXNcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGVudGl0eUlkXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoXG4gICAqIEBwYXJhbSB7SFRNTEVsZW1lbnR9IGVsXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHJlbW92ZUVsZW1lbnQgKGVudGl0eUlkLCBwYXRoLCBlbCkge1xuICAgIHZhciBjaGlsZHJlbkJ5UGF0aCA9IGNoaWxkcmVuW2VudGl0eUlkXVxuICAgIHZhciBjaGlsZElkID0gY2hpbGRyZW5CeVBhdGhbcGF0aF1cbiAgICB2YXIgZW50aXR5SGFuZGxlcnMgPSBoYW5kbGVyc1tlbnRpdHlJZF0gfHwge31cbiAgICB2YXIgcmVtb3ZhbHMgPSBbXVxuXG4gICAgLy8gSWYgdGhlIHBhdGggcG9pbnRzIHRvIGEgY29tcG9uZW50IHdlIHNob3VsZCB1c2UgdGhhdFxuICAgIC8vIGNvbXBvbmVudHMgZWxlbWVudCBpbnN0ZWFkLCBiZWNhdXNlIGl0IG1pZ2h0IGhhdmUgbW92ZWQgaXQuXG4gICAgaWYgKGNoaWxkSWQpIHtcbiAgICAgIHZhciBjaGlsZCA9IGVudGl0aWVzW2NoaWxkSWRdXG4gICAgICBlbCA9IGNoaWxkLm5hdGl2ZUVsZW1lbnRcbiAgICAgIHVubW91bnRFbnRpdHkoY2hpbGRJZClcbiAgICAgIHJlbW92YWxzLnB1c2gocGF0aClcbiAgICB9IGVsc2Uge1xuXG4gICAgICAvLyBKdXN0IHJlbW92ZSB0aGUgdGV4dCBub2RlXG4gICAgICBpZiAoIWlzRWxlbWVudChlbCkpIHJldHVybiBlbCAmJiBlbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGVsKVxuXG4gICAgICAvLyBUaGVuIHdlIG5lZWQgdG8gZmluZCBhbnkgY29tcG9uZW50cyB3aXRoaW4gdGhpc1xuICAgICAgLy8gYnJhbmNoIGFuZCB1bm1vdW50IHRoZW0uXG4gICAgICBmb3JFYWNoKGNoaWxkcmVuQnlQYXRoLCBmdW5jdGlvbiAoY2hpbGRJZCwgY2hpbGRQYXRoKSB7XG4gICAgICAgIGlmIChjaGlsZFBhdGggPT09IHBhdGggfHwgaXNXaXRoaW5QYXRoKHBhdGgsIGNoaWxkUGF0aCkpIHtcbiAgICAgICAgICB1bm1vdW50RW50aXR5KGNoaWxkSWQpXG4gICAgICAgICAgcmVtb3ZhbHMucHVzaChjaGlsZFBhdGgpXG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICAgIC8vIFJlbW92ZSBhbGwgZXZlbnRzIGF0IHRoaXMgcGF0aCBvciBiZWxvdyBpdFxuICAgICAgZm9yRWFjaChlbnRpdHlIYW5kbGVycywgZnVuY3Rpb24gKGZuLCBoYW5kbGVyUGF0aCkge1xuICAgICAgICBpZiAoaGFuZGxlclBhdGggPT09IHBhdGggfHwgaXNXaXRoaW5QYXRoKHBhdGgsIGhhbmRsZXJQYXRoKSkge1xuICAgICAgICAgIHJlbW92ZUV2ZW50KGVudGl0eUlkLCBoYW5kbGVyUGF0aClcbiAgICAgICAgfVxuICAgICAgfSlcbiAgICB9XG5cbiAgICAvLyBSZW1vdmUgdGhlIHBhdGhzIGZyb20gdGhlIG9iamVjdCB3aXRob3V0IHRvdWNoaW5nIHRoZVxuICAgIC8vIG9sZCBvYmplY3QuIFRoaXMga2VlcHMgdGhlIG9iamVjdCB1c2luZyBmYXN0IHByb3BlcnRpZXMuXG4gICAgZm9yRWFjaChyZW1vdmFscywgZnVuY3Rpb24gKHBhdGgpIHtcbiAgICAgIGRlbGV0ZSBjaGlsZHJlbltlbnRpdHlJZF1bcGF0aF1cbiAgICB9KVxuXG4gICAgLy8gUmVtb3ZlIGl0IGZyb20gdGhlIERPTVxuICAgIGVsLnBhcmVudE5vZGUucmVtb3ZlQ2hpbGQoZWwpXG4gIH1cblxuICAvKipcbiAgICogUmVwbGFjZSBhbiBlbGVtZW50IGluIHRoZSBET00uIFJlbW92aW5nIGFsbCBjb21wb25lbnRzXG4gICAqIHdpdGhpbiB0aGF0IGVsZW1lbnQgYW5kIHJlLXJlbmRlcmluZyB0aGUgbmV3IHZpcnR1YWwgbm9kZS5cbiAgICpcbiAgICogQHBhcmFtIHtFbnRpdHl9IGVudGl0eVxuICAgKiBAcGFyYW0ge1N0cmluZ30gcGF0aFxuICAgKiBAcGFyYW0ge0hUTUxFbGVtZW50fSBlbFxuICAgKiBAcGFyYW0ge09iamVjdH0gdm5vZGVcbiAgICpcbiAgICogQHJldHVybiB7dm9pZH1cbiAgICovXG5cbiAgZnVuY3Rpb24gcmVwbGFjZUVsZW1lbnQgKGVudGl0eUlkLCBwYXRoLCBlbCwgdm5vZGUpIHtcbiAgICB2YXIgcGFyZW50ID0gZWwucGFyZW50Tm9kZVxuICAgIHZhciBpbmRleCA9IEFycmF5LnByb3RvdHlwZS5pbmRleE9mLmNhbGwocGFyZW50LmNoaWxkTm9kZXMsIGVsKVxuXG4gICAgLy8gcmVtb3ZlIHRoZSBwcmV2aW91cyBlbGVtZW50IGFuZCBhbGwgbmVzdGVkIGNvbXBvbmVudHMuIFRoaXNcbiAgICAvLyBuZWVkcyB0byBoYXBwZW4gYmVmb3JlIHdlIGNyZWF0ZSB0aGUgbmV3IGVsZW1lbnQgc28gd2UgZG9uJ3RcbiAgICAvLyBnZXQgY2xhc2hlcyBvbiB0aGUgY29tcG9uZW50IHBhdGhzLlxuICAgIHJlbW92ZUVsZW1lbnQoZW50aXR5SWQsIHBhdGgsIGVsKVxuXG4gICAgLy8gdGhlbiBhZGQgdGhlIG5ldyBlbGVtZW50IGluIHRoZXJlXG4gICAgdmFyIG5ld0VsID0gdG9OYXRpdmUoZW50aXR5SWQsIHBhdGgsIHZub2RlKVxuICAgIHZhciB0YXJnZXQgPSBwYXJlbnQuY2hpbGROb2Rlc1tpbmRleF1cblxuICAgIGlmICh0YXJnZXQpIHtcbiAgICAgIHBhcmVudC5pbnNlcnRCZWZvcmUobmV3RWwsIHRhcmdldClcbiAgICB9IGVsc2Uge1xuICAgICAgcGFyZW50LmFwcGVuZENoaWxkKG5ld0VsKVxuICAgIH1cblxuICAgIC8vIHdhbGsgdXAgdGhlIHRyZWUgYW5kIHVwZGF0ZSBhbGwgYGVudGl0eS5uYXRpdmVFbGVtZW50YCByZWZlcmVuY2VzLlxuICAgIGlmIChlbnRpdHlJZCAhPT0gJ3Jvb3QnICYmIHBhdGggPT09ICcwJykge1xuICAgICAgdXBkYXRlTmF0aXZlRWxlbWVudChlbnRpdHlJZCwgbmV3RWwpXG4gICAgfVxuXG4gICAgcmV0dXJuIG5ld0VsXG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGFsbCBlbnRpdGllcyBpbiBhIGJyYW5jaCB0aGF0IGhhdmUgdGhlIHNhbWUgbmF0aXZlRWxlbWVudC4gVGhpc1xuICAgKiBoYXBwZW5zIHdoZW4gYSBjb21wb25lbnQgaGFzIGFub3RoZXIgY29tcG9uZW50IGFzIGl0J3Mgcm9vdCBub2RlLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gZW50aXR5SWRcbiAgICogQHBhcmFtIHtIVE1MRWxlbWVudH0gbmV3RWxcbiAgICpcbiAgICogQHJldHVybiB7dm9pZH1cbiAgICovXG5cbiAgZnVuY3Rpb24gdXBkYXRlTmF0aXZlRWxlbWVudCAoZW50aXR5SWQsIG5ld0VsKSB7XG4gICAgdmFyIHRhcmdldCA9IGVudGl0aWVzW2VudGl0eUlkXVxuICAgIGlmICh0YXJnZXQub3duZXJJZCA9PT0gJ3Jvb3QnKSByZXR1cm5cbiAgICBpZiAoY2hpbGRyZW5bdGFyZ2V0Lm93bmVySWRdWycwJ10gPT09IGVudGl0eUlkKSB7XG4gICAgICBlbnRpdGllc1t0YXJnZXQub3duZXJJZF0ubmF0aXZlRWxlbWVudCA9IG5ld0VsXG4gICAgICB1cGRhdGVOYXRpdmVFbGVtZW50KHRhcmdldC5vd25lcklkLCBuZXdFbClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogU2V0IHRoZSBhdHRyaWJ1dGUgb2YgYW4gZWxlbWVudCwgcGVyZm9ybWluZyBhZGRpdGlvbmFsIHRyYW5zZm9ybWF0aW9uc1xuICAgKiBkZXBlbmRuaW5nIG9uIHRoZSBhdHRyaWJ1dGUgbmFtZVxuICAgKlxuICAgKiBAcGFyYW0ge0hUTUxFbGVtZW50fSBlbFxuICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZVxuICAgKiBAcGFyYW0ge1N0cmluZ30gdmFsdWVcbiAgICovXG5cbiAgZnVuY3Rpb24gc2V0QXR0cmlidXRlIChlbnRpdHlJZCwgcGF0aCwgZWwsIG5hbWUsIHZhbHVlKSB7XG4gICAgaWYgKCF2YWx1ZSkge1xuICAgICAgcmVtb3ZlQXR0cmlidXRlKGVudGl0eUlkLCBwYXRoLCBlbCwgbmFtZSlcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBpZiAoZXZlbnRzW25hbWVdKSB7XG4gICAgICBhZGRFdmVudChlbnRpdHlJZCwgcGF0aCwgZXZlbnRzW25hbWVdLCB2YWx1ZSlcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBzd2l0Y2ggKG5hbWUpIHtcbiAgICAgIGNhc2UgJ2NoZWNrZWQnOlxuICAgICAgY2FzZSAnZGlzYWJsZWQnOlxuICAgICAgY2FzZSAnc2VsZWN0ZWQnOlxuICAgICAgICBlbFtuYW1lXSA9IHRydWVcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgJ2lubmVySFRNTCc6XG4gICAgICAgIGVsLmlubmVySFRNTCA9IHZhbHVlXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICd2YWx1ZSc6XG4gICAgICAgIHNldEVsZW1lbnRWYWx1ZShlbCwgdmFsdWUpXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlIHN2Zy5pc0F0dHJpYnV0ZShuYW1lKTpcbiAgICAgICAgZWwuc2V0QXR0cmlidXRlTlMoc3ZnLm5hbWVzcGFjZSwgbmFtZSwgdmFsdWUpXG4gICAgICAgIGJyZWFrXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBlbC5zZXRBdHRyaWJ1dGUobmFtZSwgdmFsdWUpXG4gICAgICAgIGJyZWFrXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbW92ZSBhbiBhdHRyaWJ1dGUsIHBlcmZvcm1pbmcgYWRkaXRpb25hbCB0cmFuc2Zvcm1hdGlvbnNcbiAgICogZGVwZW5kbmluZyBvbiB0aGUgYXR0cmlidXRlIG5hbWVcbiAgICpcbiAgICogQHBhcmFtIHtIVE1MRWxlbWVudH0gZWxcbiAgICogQHBhcmFtIHtTdHJpbmd9IG5hbWVcbiAgICovXG5cbiAgZnVuY3Rpb24gcmVtb3ZlQXR0cmlidXRlIChlbnRpdHlJZCwgcGF0aCwgZWwsIG5hbWUpIHtcbiAgICBpZiAoZXZlbnRzW25hbWVdKSB7XG4gICAgICByZW1vdmVFdmVudChlbnRpdHlJZCwgcGF0aCwgZXZlbnRzW25hbWVdKVxuICAgICAgcmV0dXJuXG4gICAgfVxuICAgIHN3aXRjaCAobmFtZSkge1xuICAgICAgY2FzZSAnY2hlY2tlZCc6XG4gICAgICBjYXNlICdkaXNhYmxlZCc6XG4gICAgICBjYXNlICdzZWxlY3RlZCc6XG4gICAgICAgIGVsW25hbWVdID0gZmFsc2VcbiAgICAgICAgYnJlYWtcbiAgICAgIGNhc2UgJ2lubmVySFRNTCc6XG4gICAgICAgIGVsLmlubmVySFRNTCA9ICcnXG4gICAgICBjYXNlICd2YWx1ZSc6XG4gICAgICAgIHNldEVsZW1lbnRWYWx1ZShlbCwgbnVsbClcbiAgICAgICAgYnJlYWtcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGVsLnJlbW92ZUF0dHJpYnV0ZShuYW1lKVxuICAgICAgICBicmVha1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDaGVja3MgdG8gc2VlIGlmIG9uZSB0cmVlIHBhdGggaXMgd2l0aGluXG4gICAqIGFub3RoZXIgdHJlZSBwYXRoLiBFeGFtcGxlOlxuICAgKlxuICAgKiAwLjEgdnMgMC4xLjEgPSB0cnVlXG4gICAqIDAuMiB2cyAwLjMuNSA9IGZhbHNlXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSB0YXJnZXRcbiAgICogQHBhcmFtIHtTdHJpbmd9IHBhdGhcbiAgICpcbiAgICogQHJldHVybiB7Qm9vbGVhbn1cbiAgICovXG5cbiAgZnVuY3Rpb24gaXNXaXRoaW5QYXRoICh0YXJnZXQsIHBhdGgpIHtcbiAgICByZXR1cm4gcGF0aC5pbmRleE9mKHRhcmdldCArICcuJykgPT09IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBJcyB0aGUgRE9NIG5vZGUgYW4gZWxlbWVudCBub2RlXG4gICAqXG4gICAqIEBwYXJhbSB7SFRNTEVsZW1lbnR9IGVsXG4gICAqXG4gICAqIEByZXR1cm4ge0Jvb2xlYW59XG4gICAqL1xuXG4gIGZ1bmN0aW9uIGlzRWxlbWVudCAoZWwpIHtcbiAgICByZXR1cm4gISEoZWwgJiYgZWwudGFnTmFtZSlcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmUgYWxsIHRoZSBjaGlsZCBub2RlcyBmcm9tIGFuIGVsZW1lbnRcbiAgICpcbiAgICogQHBhcmFtIHtIVE1MRWxlbWVudH0gZWxcbiAgICovXG5cbiAgZnVuY3Rpb24gcmVtb3ZlQWxsQ2hpbGRyZW4gKGVsKSB7XG4gICAgd2hpbGUgKGVsLmZpcnN0Q2hpbGQpIGVsLnJlbW92ZUNoaWxkKGVsLmZpcnN0Q2hpbGQpXG4gIH1cblxuICAvKipcbiAgICogVHJpZ2dlciBhIGhvb2sgb24gYSBjb21wb25lbnQuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lIE5hbWUgb2YgaG9vay5cbiAgICogQHBhcmFtIHtFbnRpdHl9IGVudGl0eSBUaGUgY29tcG9uZW50IGluc3RhbmNlLlxuICAgKiBAcGFyYW0ge0FycmF5fSBhcmdzIFRvIHBhc3MgYWxvbmcgdG8gaG9vay5cbiAgICovXG5cbiAgZnVuY3Rpb24gdHJpZ2dlciAobmFtZSwgZW50aXR5LCBhcmdzKSB7XG4gICAgaWYgKHR5cGVvZiBlbnRpdHkuY29tcG9uZW50W25hbWVdICE9PSAnZnVuY3Rpb24nKSByZXR1cm5cbiAgICByZXR1cm4gZW50aXR5LmNvbXBvbmVudFtuYW1lXS5hcHBseShudWxsLCBhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBhbiBlbnRpdHkgdG8gbWF0Y2ggdGhlIGxhdGVzdCByZW5kZXJlZCB2b2RlLiBXZSBhbHdheXNcbiAgICogcmVwbGFjZSB0aGUgcHJvcHMgb24gdGhlIGNvbXBvbmVudCB3aGVuIGNvbXBvc2luZyB0aGVtLiBUaGlzXG4gICAqIHdpbGwgdHJpZ2dlciBhIHJlLXJlbmRlciBvbiBhbGwgY2hpbGRyZW4gYmVsb3cgdGhpcyBwb2ludC5cbiAgICpcbiAgICogQHBhcmFtIHtFbnRpdHl9IGVudGl0eVxuICAgKiBAcGFyYW0ge1N0cmluZ30gcGF0aFxuICAgKiBAcGFyYW0ge09iamVjdH0gdm5vZGVcbiAgICpcbiAgICogQHJldHVybiB7dm9pZH1cbiAgICovXG5cbiAgZnVuY3Rpb24gdXBkYXRlRW50aXR5UHJvcHMgKGVudGl0eUlkLCBuZXh0UHJvcHMpIHtcbiAgICB2YXIgZW50aXR5ID0gZW50aXRpZXNbZW50aXR5SWRdXG4gICAgZW50aXR5LnBlbmRpbmdQcm9wcyA9IGRlZmF1bHRzKHt9LCBuZXh0UHJvcHMsIGVudGl0eS5jb21wb25lbnQuZGVmYXVsdFByb3BzIHx8IHt9KVxuICAgIGVudGl0eS5kaXJ0eSA9IHRydWVcbiAgICBpbnZhbGlkYXRlKClcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgY29tcG9uZW50IGluc3RhbmNlIHN0YXRlLlxuICAgKi9cblxuICBmdW5jdGlvbiB1cGRhdGVFbnRpdHlTdGF0ZSAoZW50aXR5LCBuZXh0U3RhdGUpIHtcbiAgICBlbnRpdHkucGVuZGluZ1N0YXRlID0gYXNzaWduKGVudGl0eS5wZW5kaW5nU3RhdGUsIG5leHRTdGF0ZSlcbiAgICBlbnRpdHkuZGlydHkgPSB0cnVlXG4gICAgaW52YWxpZGF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogQ29tbWl0IHByb3BzIGFuZCBzdGF0ZSBjaGFuZ2VzIHRvIGFuIGVudGl0eS5cbiAgICovXG5cbiAgZnVuY3Rpb24gY29tbWl0IChlbnRpdHkpIHtcbiAgICBlbnRpdHkuY29udGV4dCA9IHtcbiAgICAgIHN0YXRlOiBlbnRpdHkucGVuZGluZ1N0YXRlLFxuICAgICAgcHJvcHM6IGVudGl0eS5wZW5kaW5nUHJvcHMsXG4gICAgICBpZDogZW50aXR5LmlkXG4gICAgfVxuICAgIGVudGl0eS5wZW5kaW5nU3RhdGUgPSBhc3NpZ24oe30sIGVudGl0eS5jb250ZXh0LnN0YXRlKVxuICAgIGVudGl0eS5wZW5kaW5nUHJvcHMgPSBhc3NpZ24oe30sIGVudGl0eS5jb250ZXh0LnByb3BzKVxuICAgIGVudGl0eS5kaXJ0eSA9IGZhbHNlXG4gICAgaWYgKHR5cGVvZiBlbnRpdHkuY29tcG9uZW50LnZhbGlkYXRlID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICBlbnRpdHkuY29tcG9uZW50LnZhbGlkYXRlKGVudGl0eS5jb250ZXh0KVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBUcnkgdG8gYXZvaWQgY3JlYXRpbmcgbmV3IHZpcnR1YWwgZG9tIGlmIHBvc3NpYmxlLlxuICAgKlxuICAgKiBMYXRlciB3ZSBtYXkgZXhwb3NlIHRoaXMgc28geW91IGNhbiBvdmVycmlkZSwgYnV0IG5vdCB0aGVyZSB5ZXQuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHNob3VsZFVwZGF0ZSAoZW50aXR5KSB7XG4gICAgaWYgKCFlbnRpdHkuZGlydHkpIHJldHVybiBmYWxzZVxuICAgIGlmICghZW50aXR5LmNvbXBvbmVudC5zaG91bGRVcGRhdGUpIHJldHVybiB0cnVlXG4gICAgdmFyIG5leHRQcm9wcyA9IGVudGl0eS5wZW5kaW5nUHJvcHNcbiAgICB2YXIgbmV4dFN0YXRlID0gZW50aXR5LnBlbmRpbmdTdGF0ZVxuICAgIHZhciBib29sID0gZW50aXR5LmNvbXBvbmVudC5zaG91bGRVcGRhdGUoZW50aXR5LmNvbnRleHQsIG5leHRQcm9wcywgbmV4dFN0YXRlKVxuICAgIHJldHVybiBib29sXG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXIgYW4gZW50aXR5LlxuICAgKlxuICAgKiBUaGlzIGlzIG1vc3RseSB0byBwcmUtcHJlcHJvY2VzcyBjb21wb25lbnQgcHJvcGVydGllcyBhbmQgdmFsdWVzIGNoYWlucy5cbiAgICpcbiAgICogVGhlIGVuZCByZXN1bHQgaXMgZm9yIGV2ZXJ5IGNvbXBvbmVudCB0aGF0IGdldHMgbW91bnRlZCxcbiAgICogeW91IGNyZWF0ZSBhIHNldCBvZiBJTyBub2RlcyBpbiB0aGUgbmV0d29yayBmcm9tIHRoZSBgdmFsdWVgIGRlZmluaXRpb25zLlxuICAgKlxuICAgKiBAcGFyYW0ge0NvbXBvbmVudH0gY29tcG9uZW50XG4gICAqL1xuXG4gIGZ1bmN0aW9uIHJlZ2lzdGVyIChlbnRpdHkpIHtcbiAgICByZWdpc3RlckVudGl0eShlbnRpdHkpXG4gICAgdmFyIGNvbXBvbmVudCA9IGVudGl0eS5jb21wb25lbnRcbiAgICBpZiAoY29tcG9uZW50LnJlZ2lzdGVyZWQpIHJldHVyblxuXG4gICAgLy8gaW5pdGlhbGl6ZSBzb3VyY2VzIG9uY2UgZm9yIGEgY29tcG9uZW50IHR5cGUuXG4gICAgcmVnaXN0ZXJTb3VyY2VzKGVudGl0eSlcbiAgICBjb21wb25lbnQucmVnaXN0ZXJlZCA9IHRydWVcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgZW50aXR5IHRvIGRhdGEtc3RydWN0dXJlcyByZWxhdGVkIHRvIGNvbXBvbmVudHMvZW50aXRpZXMuXG4gICAqXG4gICAqIEBwYXJhbSB7RW50aXR5fSBlbnRpdHlcbiAgICovXG5cbiAgZnVuY3Rpb24gcmVnaXN0ZXJFbnRpdHkoZW50aXR5KSB7XG4gICAgdmFyIGNvbXBvbmVudCA9IGVudGl0eS5jb21wb25lbnRcbiAgICAvLyBhbGwgZW50aXRpZXMgZm9yIHRoaXMgY29tcG9uZW50IHR5cGUuXG4gICAgdmFyIGVudGl0aWVzID0gY29tcG9uZW50LmVudGl0aWVzID0gY29tcG9uZW50LmVudGl0aWVzIHx8IHt9XG4gICAgLy8gYWRkIGVudGl0eSB0byBjb21wb25lbnQgbGlzdFxuICAgIGVudGl0aWVzW2VudGl0eS5pZF0gPSBlbnRpdHlcbiAgICAvLyBtYXAgdG8gY29tcG9uZW50IHNvIHlvdSBjYW4gcmVtb3ZlIGxhdGVyLlxuICAgIGNvbXBvbmVudHNbZW50aXR5LmlkXSA9IGNvbXBvbmVudFxuICB9XG5cbiAgLyoqXG4gICAqIEluaXRpYWxpemUgc291cmNlcyBmb3IgYSBjb21wb25lbnQgYnkgdHlwZS5cbiAgICpcbiAgICogQHBhcmFtIHtFbnRpdHl9IGVudGl0eVxuICAgKi9cblxuICBmdW5jdGlvbiByZWdpc3RlclNvdXJjZXMoZW50aXR5KSB7XG4gICAgdmFyIGNvbXBvbmVudCA9IGNvbXBvbmVudHNbZW50aXR5LmlkXVxuICAgIC8vIGdldCAnY2xhc3MtbGV2ZWwnIHNvdXJjZXMuXG4gICAgLy8gaWYgd2UndmUgYWxyZWFkeSBob29rZWQgaXQgdXAsIHRoZW4gd2UncmUgZ29vZC5cbiAgICB2YXIgc291cmNlcyA9IGNvbXBvbmVudC5zb3VyY2VzXG4gICAgaWYgKHNvdXJjZXMpIHJldHVyblxuICAgIHZhciBlbnRpdGllcyA9IGNvbXBvbmVudC5lbnRpdGllc1xuXG4gICAgLy8gaG9vayB1cCBzb3VyY2VzLlxuICAgIHZhciBtYXAgPSBjb21wb25lbnQuc291cmNlVG9Qcm9wZXJ0eU5hbWUgPSB7fVxuICAgIGNvbXBvbmVudC5zb3VyY2VzID0gc291cmNlcyA9IFtdXG4gICAgdmFyIHByb3BUeXBlcyA9IGNvbXBvbmVudC5wcm9wVHlwZXNcbiAgICBmb3IgKHZhciBuYW1lIGluIHByb3BUeXBlcykge1xuICAgICAgdmFyIGRhdGEgPSBwcm9wVHlwZXNbbmFtZV1cbiAgICAgIGlmICghZGF0YSkgY29udGludWVcbiAgICAgIGlmICghZGF0YS5zb3VyY2UpIGNvbnRpbnVlXG4gICAgICBzb3VyY2VzLnB1c2goZGF0YS5zb3VyY2UpXG4gICAgICBtYXBbZGF0YS5zb3VyY2VdID0gbmFtZVxuICAgIH1cblxuICAgIC8vIHNlbmQgdmFsdWUgdXBkYXRlcyB0byBhbGwgY29tcG9uZW50IGluc3RhbmNlcy5cbiAgICBzb3VyY2VzLmZvckVhY2goZnVuY3Rpb24gKHNvdXJjZSkge1xuICAgICAgY29ubmVjdGlvbnNbc291cmNlXSA9IGNvbm5lY3Rpb25zW3NvdXJjZV0gfHwgW11cbiAgICAgIGNvbm5lY3Rpb25zW3NvdXJjZV0ucHVzaCh1cGRhdGUpXG5cbiAgICAgIGZ1bmN0aW9uIHVwZGF0ZSAoZGF0YSkge1xuICAgICAgICB2YXIgcHJvcCA9IG1hcFtzb3VyY2VdXG4gICAgICAgIGZvciAodmFyIGVudGl0eUlkIGluIGVudGl0aWVzKSB7XG4gICAgICAgICAgdmFyIGVudGl0eSA9IGVudGl0aWVzW2VudGl0eUlkXVxuICAgICAgICAgIHZhciBjaGFuZ2VzID0ge31cbiAgICAgICAgICBjaGFuZ2VzW3Byb3BdID0gZGF0YVxuICAgICAgICAgIHVwZGF0ZUVudGl0eVByb3BzKGVudGl0eUlkLCBhc3NpZ24oZW50aXR5LnBlbmRpbmdQcm9wcywgY2hhbmdlcykpXG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFNldCB0aGUgaW5pdGlhbCBzb3VyY2UgdmFsdWUgb24gdGhlIGVudGl0eVxuICAgKlxuICAgKiBAcGFyYW0ge0VudGl0eX0gZW50aXR5XG4gICAqL1xuXG4gIGZ1bmN0aW9uIHNldFNvdXJjZXMgKGVudGl0eSkge1xuICAgIHZhciBjb21wb25lbnQgPSBlbnRpdHkuY29tcG9uZW50XG4gICAgdmFyIG1hcCA9IGNvbXBvbmVudC5zb3VyY2VUb1Byb3BlcnR5TmFtZVxuICAgIHZhciBzb3VyY2VzID0gY29tcG9uZW50LnNvdXJjZXNcbiAgICBzb3VyY2VzLmZvckVhY2goZnVuY3Rpb24gKHNvdXJjZSkge1xuICAgICAgdmFyIG5hbWUgPSBtYXBbc291cmNlXVxuICAgICAgaWYgKGVudGl0eS5wZW5kaW5nUHJvcHNbbmFtZV0gIT0gbnVsbCkgcmV0dXJuXG4gICAgICBlbnRpdHkucGVuZGluZ1Byb3BzW25hbWVdID0gYXBwLnNvdXJjZXNbc291cmNlXSAvLyBnZXQgbGF0ZXN0IHZhbHVlIHBsdWdnZWQgaW50byBnbG9iYWwgc3RvcmVcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEFkZCBhbGwgb2YgdGhlIERPTSBldmVudCBsaXN0ZW5lcnNcbiAgICovXG5cbiAgZnVuY3Rpb24gYWRkTmF0aXZlRXZlbnRMaXN0ZW5lcnMgKCkge1xuICAgIGZvckVhY2goZXZlbnRzLCBmdW5jdGlvbiAoZXZlbnRUeXBlKSB7XG4gICAgICByb290RWxlbWVudC5hZGRFdmVudExpc3RlbmVyKGV2ZW50VHlwZSwgaGFuZGxlRXZlbnQsIHRydWUpXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYWxsIG9mIHRoZSBET00gZXZlbnQgbGlzdGVuZXJzXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHJlbW92ZU5hdGl2ZUV2ZW50TGlzdGVuZXJzICgpIHtcbiAgICBmb3JFYWNoKGV2ZW50cywgZnVuY3Rpb24gKGV2ZW50VHlwZSkge1xuICAgICAgcm9vdEVsZW1lbnQucmVtb3ZlRXZlbnRMaXN0ZW5lcihldmVudFR5cGUsIGhhbmRsZUV2ZW50LCB0cnVlKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogSGFuZGxlIGFuIGV2ZW50IHRoYXQgaGFzIG9jY3VyZWQgd2l0aGluIHRoZSBjb250YWluZXJcbiAgICpcbiAgICogQHBhcmFtIHtFdmVudH0gZXZlbnRcbiAgICovXG5cbiAgZnVuY3Rpb24gaGFuZGxlRXZlbnQgKGV2ZW50KSB7XG4gICAgdmFyIHRhcmdldCA9IGV2ZW50LnRhcmdldFxuICAgIHZhciBldmVudFR5cGUgPSBldmVudC50eXBlXG5cbiAgICAvLyBXYWxrIHVwIHRoZSBET00gdHJlZSBhbmQgc2VlIGlmIHRoZXJlIGlzIGEgaGFuZGxlclxuICAgIC8vIGZvciB0aGlzIGV2ZW50IHR5cGUgaGlnaGVyIHVwLlxuICAgIHdoaWxlICh0YXJnZXQpIHtcbiAgICAgIHZhciBmbiA9IGtleXBhdGguZ2V0KGhhbmRsZXJzLCBbdGFyZ2V0Ll9fZW50aXR5X18sIHRhcmdldC5fX3BhdGhfXywgZXZlbnRUeXBlXSlcbiAgICAgIGlmIChmbikge1xuICAgICAgICBldmVudC5kZWxlZ2F0ZVRhcmdldCA9IHRhcmdldFxuICAgICAgICBpZiAoZm4oZXZlbnQpID09PSBmYWxzZSkgYnJlYWtcbiAgICAgIH1cbiAgICAgIHRhcmdldCA9IHRhcmdldC5wYXJlbnROb2RlXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIEJpbmQgZXZlbnRzIGZvciBhbiBlbGVtZW50LCBhbmQgYWxsIGl0J3MgcmVuZGVyZWQgY2hpbGQgZWxlbWVudHMuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICAgKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICAgKi9cblxuICBmdW5jdGlvbiBhZGRFdmVudCAoZW50aXR5SWQsIHBhdGgsIGV2ZW50VHlwZSwgZm4pIHtcbiAgICBrZXlwYXRoLnNldChoYW5kbGVycywgW2VudGl0eUlkLCBwYXRoLCBldmVudFR5cGVdLCBmdW5jdGlvbiAoZSkge1xuICAgICAgdmFyIGVudGl0eSA9IGVudGl0aWVzW2VudGl0eUlkXVxuICAgICAgaWYgKGVudGl0eSkge1xuICAgICAgICByZXR1cm4gZm4uY2FsbChudWxsLCBlLCBlbnRpdHkuY29udGV4dCwgc2V0U3RhdGUoZW50aXR5KSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBmbi5jYWxsKG51bGwsIGUpXG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBVbmJpbmQgZXZlbnRzIGZvciBhIGVudGl0eUlkXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBlbnRpdHlJZFxuICAgKi9cblxuICBmdW5jdGlvbiByZW1vdmVFdmVudCAoZW50aXR5SWQsIHBhdGgsIGV2ZW50VHlwZSkge1xuICAgIHZhciBhcmdzID0gW2VudGl0eUlkXVxuICAgIGlmIChwYXRoKSBhcmdzLnB1c2gocGF0aClcbiAgICBpZiAoZXZlbnRUeXBlKSBhcmdzLnB1c2goZXZlbnRUeXBlKVxuICAgIGtleXBhdGguZGVsKGhhbmRsZXJzLCBhcmdzKVxuICB9XG5cbiAgLyoqXG4gICAqIFVuYmluZCBhbGwgZXZlbnRzIGZyb20gYW4gZW50aXR5XG4gICAqXG4gICAqIEBwYXJhbSB7RW50aXR5fSBlbnRpdHlcbiAgICovXG5cbiAgZnVuY3Rpb24gcmVtb3ZlQWxsRXZlbnRzIChlbnRpdHlJZCkge1xuICAgIGtleXBhdGguZGVsKGhhbmRsZXJzLCBbZW50aXR5SWRdKVxuICB9XG5cbiAgLyoqXG4gICAqIFVzZWQgZm9yIGRlYnVnZ2luZyB0byBpbnNwZWN0IHRoZSBjdXJyZW50IHN0YXRlIHdpdGhvdXRcbiAgICogdXMgbmVlZGluZyB0byBleHBsaWNpdGx5IG1hbmFnZSBzdG9yaW5nL3VwZGF0aW5nIHJlZmVyZW5jZXMuXG4gICAqXG4gICAqIEByZXR1cm4ge09iamVjdH1cbiAgICovXG5cbiAgZnVuY3Rpb24gaW5zcGVjdCAoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGVudGl0aWVzOiBlbnRpdGllcyxcbiAgICAgIGhhbmRsZXJzOiBoYW5kbGVycyxcbiAgICAgIGNvbm5lY3Rpb25zOiBjb25uZWN0aW9ucyxcbiAgICAgIGN1cnJlbnRFbGVtZW50OiBjdXJyZW50RWxlbWVudCxcbiAgICAgIG9wdGlvbnM6IG9wdGlvbnMsXG4gICAgICBhcHA6IGFwcCxcbiAgICAgIGNvbnRhaW5lcjogY29udGFpbmVyLFxuICAgICAgY2hpbGRyZW46IGNoaWxkcmVuXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFJldHVybiBhbiBvYmplY3QgdGhhdCBsZXRzIHVzIGNvbXBsZXRlbHkgcmVtb3ZlIHRoZSBhdXRvbWF0aWNcbiAgICogRE9NIHJlbmRlcmluZyBhbmQgZXhwb3J0IGRlYnVnZ2luZyB0b29scy5cbiAgICovXG5cbiAgcmV0dXJuIHtcbiAgICByZW1vdmU6IHRlYXJkb3duLFxuICAgIGluc3BlY3Q6IGluc3BlY3RcbiAgfVxufVxuXG4vKipcbiAqIEEgcmVuZGVyZWQgY29tcG9uZW50IGluc3RhbmNlLlxuICpcbiAqIFRoaXMgbWFuYWdlcyB0aGUgbGlmZWN5Y2xlLCBwcm9wcyBhbmQgc3RhdGUgb2YgdGhlIGNvbXBvbmVudC5cbiAqIEl0J3MgYmFzaWNhbGx5IGp1c3QgYSBkYXRhIG9iamVjdCBmb3IgbW9yZSBzdHJhaWdodGZvd2FyZCBsb29rdXAuXG4gKlxuICogQHBhcmFtIHtDb21wb25lbnR9IGNvbXBvbmVudFxuICogQHBhcmFtIHtPYmplY3R9IHByb3BzXG4gKi9cblxuZnVuY3Rpb24gRW50aXR5IChjb21wb25lbnQsIHByb3BzLCBvd25lcklkKSB7XG4gIHRoaXMuaWQgPSB1aWQoKVxuICB0aGlzLm93bmVySWQgPSBvd25lcklkXG4gIHRoaXMuY29tcG9uZW50ID0gY29tcG9uZW50XG4gIHRoaXMucHJvcFR5cGVzID0gY29tcG9uZW50LnByb3BUeXBlcyB8fCB7fVxuICB0aGlzLmNvbnRleHQgPSB7fVxuICB0aGlzLmNvbnRleHQuaWQgPSB0aGlzLmlkXG4gIHRoaXMuY29udGV4dC5wcm9wcyA9IGRlZmF1bHRzKHByb3BzIHx8IHt9LCBjb21wb25lbnQuZGVmYXVsdFByb3BzIHx8IHt9KVxuICB0aGlzLmNvbnRleHQuc3RhdGUgPSB0aGlzLmNvbXBvbmVudC5pbml0aWFsU3RhdGUgPyB0aGlzLmNvbXBvbmVudC5pbml0aWFsU3RhdGUodGhpcy5jb250ZXh0LnByb3BzKSA6IHt9XG4gIHRoaXMucGVuZGluZ1Byb3BzID0gYXNzaWduKHt9LCB0aGlzLmNvbnRleHQucHJvcHMpXG4gIHRoaXMucGVuZGluZ1N0YXRlID0gYXNzaWduKHt9LCB0aGlzLmNvbnRleHQuc3RhdGUpXG4gIHRoaXMuZGlydHkgPSBmYWxzZVxuICB0aGlzLnZpcnR1YWxFbGVtZW50ID0gbnVsbFxuICB0aGlzLm5hdGl2ZUVsZW1lbnQgPSBudWxsXG4gIHRoaXMuZGlzcGxheU5hbWUgPSBjb21wb25lbnQubmFtZSB8fCAnQ29tcG9uZW50J1xufVxuXG4vKipcbiAqIFJldHJpZXZlIHRoZSBuZWFyZXN0ICdib2R5JyBhbmNlc3RvciBvZiB0aGUgZ2l2ZW4gZWxlbWVudCBvciBlbHNlIHRoZSByb290XG4gKiBlbGVtZW50IG9mIHRoZSBkb2N1bWVudCBpbiB3aGljaCBzdGFuZHMgdGhlIGdpdmVuIGVsZW1lbnQuXG4gKlxuICogVGhpcyBpcyBuZWNlc3NhcnkgaWYgeW91IHdhbnQgdG8gYXR0YWNoIHRoZSBldmVudHMgaGFuZGxlciB0byB0aGUgY29ycmVjdFxuICogZWxlbWVudCBhbmQgYmUgYWJsZSB0byBkaXNwYXRjaCBldmVudHMgaW4gZG9jdW1lbnQgZnJhZ21lbnRzIHN1Y2ggYXNcbiAqIFNoYWRvdyBET00uXG4gKlxuICogQHBhcmFtICB7SFRNTEVsZW1lbnR9IGVsIFRoZSBlbGVtZW50IG9uIHdoaWNoIHdlIHdpbGwgcmVuZGVyIGFuIGFwcC5cbiAqIEByZXR1cm4ge0hUTUxFbGVtZW50fSAgICBUaGUgcm9vdCBlbGVtZW50IG9uIHdoaWNoIHdlIHdpbGwgYXR0YWNoIHRoZSBldmVudHNcbiAqICAgICAgICAgICAgICAgICAgICAgICAgICBoYW5kbGVyLlxuICovXG5cbmZ1bmN0aW9uIGdldFJvb3RFbGVtZW50IChlbCkge1xuICB3aGlsZSAoZWwucGFyZW50RWxlbWVudCkge1xuICAgIGlmIChlbC50YWdOYW1lID09PSAnQk9EWScgfHwgIWVsLnBhcmVudEVsZW1lbnQpIHtcbiAgICAgIHJldHVybiBlbFxuICAgIH1cbiAgICBlbCA9IGVsLnBhcmVudEVsZW1lbnRcbiAgfVxuICByZXR1cm4gZWxcbn1cblxuLyoqXG4gKiBTZXQgdGhlIHZhbHVlIHByb3BlcnR5IG9mIGFuIGVsZW1lbnQgYW5kIGtlZXAgdGhlIHRleHQgc2VsZWN0aW9uXG4gKiBmb3IgaW5wdXQgZmllbGRzLlxuICpcbiAqIEBwYXJhbSB7SFRNTEVsZW1lbnR9IGVsXG4gKiBAcGFyYW0ge1N0cmluZ30gdmFsdWVcbiAqL1xuXG5mdW5jdGlvbiBzZXRFbGVtZW50VmFsdWUgKGVsLCB2YWx1ZSkge1xuICBpZiAoZWwgPT09IGRvY3VtZW50LmFjdGl2ZUVsZW1lbnQgJiYgY2FuU2VsZWN0VGV4dChlbCkpIHtcbiAgICB2YXIgc3RhcnQgPSBlbC5zZWxlY3Rpb25TdGFydFxuICAgIHZhciBlbmQgPSBlbC5zZWxlY3Rpb25FbmRcbiAgICBlbC52YWx1ZSA9IHZhbHVlXG4gICAgZWwuc2V0U2VsZWN0aW9uUmFuZ2Uoc3RhcnQsIGVuZClcbiAgfSBlbHNlIHtcbiAgICBlbC52YWx1ZSA9IHZhbHVlXG4gIH1cbn1cblxuLyoqXG4gKiBGb3Igc29tZSByZWFzb24gb25seSBjZXJ0YWluIHR5cGVzIG9mIGlucHV0cyBjYW4gc2V0IHRoZSBzZWxlY3Rpb24gcmFuZ2UuXG4gKlxuICogQHBhcmFtIHtIVE1MRWxlbWVudH0gZWxcbiAqXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICovXG5cbmZ1bmN0aW9uIGNhblNlbGVjdFRleHQgKGVsKSB7XG4gIHJldHVybiBlbC50YWdOYW1lID09PSAnSU5QVVQnICYmIFsndGV4dCcsJ3NlYXJjaCcsJ3Bhc3N3b3JkJywndGVsJywndXJsJ10uaW5kZXhPZihlbC50eXBlKSA+IC0xXG59XG4iLCJ2YXIgZGVmYXVsdHMgPSByZXF1aXJlKCdvYmplY3QtZGVmYXVsdHMnKVxudmFyIG5vZGVUeXBlID0gcmVxdWlyZSgnLi9ub2RlLXR5cGUnKVxudmFyIHR5cGUgPSByZXF1aXJlKCdjb21wb25lbnQtdHlwZScpXG5cbi8qKlxuICogRXhwb3NlIGBzdHJpbmdpZnlgLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGFwcCkge1xuICBpZiAoIWFwcC5lbGVtZW50KSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdObyBlbGVtZW50IG1vdW50ZWQnKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbmRlciB0byBzdHJpbmcuXG4gICAqXG4gICAqIEBwYXJhbSB7Q29tcG9uZW50fSBjb21wb25lbnRcbiAgICogQHBhcmFtIHtPYmplY3R9IFtwcm9wc11cbiAgICogQHJldHVybiB7U3RyaW5nfVxuICAgKi9cblxuICBmdW5jdGlvbiBzdHJpbmdpZnkgKGNvbXBvbmVudCwgb3B0UHJvcHMsIGNoaWxkcmVuKSB7XG4gICAgdmFyIHByb3BUeXBlcyA9IGNvbXBvbmVudC5wcm9wVHlwZXMgfHwge31cbiAgICB2YXIgcHJvcHMgPSBkZWZhdWx0cyhvcHRQcm9wcyB8fCB7fSwgY29tcG9uZW50LmRlZmF1bHRQcm9wcyB8fCB7fSlcbiAgICB2YXIgc3RhdGUgPSBjb21wb25lbnQuaW5pdGlhbFN0YXRlID8gY29tcG9uZW50LmluaXRpYWxTdGF0ZShwcm9wcykgOiB7fVxuICAgIHByb3BzLmNoaWxkcmVuID0gY2hpbGRyZW47XG5cbiAgICBmb3IgKHZhciBuYW1lIGluIHByb3BUeXBlcykge1xuICAgICAgdmFyIG9wdGlvbnMgPSBwcm9wVHlwZXNbbmFtZV1cbiAgICAgIGlmIChvcHRpb25zLnNvdXJjZSkge1xuICAgICAgICBwcm9wc1tuYW1lXSA9IGFwcC5zb3VyY2VzW29wdGlvbnMuc291cmNlXVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjb21wb25lbnQuYmVmb3JlTW91bnQpIGNvbXBvbmVudC5iZWZvcmVNb3VudCh7IHByb3BzOiBwcm9wcywgc3RhdGU6IHN0YXRlIH0pXG4gICAgaWYgKGNvbXBvbmVudC5iZWZvcmVSZW5kZXIpIGNvbXBvbmVudC5iZWZvcmVSZW5kZXIoeyBwcm9wczogcHJvcHMsIHN0YXRlOiBzdGF0ZSB9KVxuICAgIHZhciBub2RlID0gY29tcG9uZW50LnJlbmRlcih7IHByb3BzOiBwcm9wcywgc3RhdGU6IHN0YXRlIH0pXG4gICAgcmV0dXJuIHN0cmluZ2lmeU5vZGUobm9kZSwgJzAnKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbmRlciBhIG5vZGUgdG8gYSBzdHJpbmdcbiAgICpcbiAgICogQHBhcmFtIHtOb2RlfSBub2RlXG4gICAqIEBwYXJhbSB7VHJlZX0gdHJlZVxuICAgKlxuICAgKiBAcmV0dXJuIHtTdHJpbmd9XG4gICAqL1xuXG4gIGZ1bmN0aW9uIHN0cmluZ2lmeU5vZGUgKG5vZGUsIHBhdGgpIHtcbiAgICBzd2l0Y2ggKG5vZGVUeXBlKG5vZGUpKSB7XG4gICAgICBjYXNlICdlbXB0eSc6IHJldHVybiAnPG5vc2NyaXB0IC8+J1xuICAgICAgY2FzZSAndGV4dCc6IHJldHVybiBub2RlXG4gICAgICBjYXNlICdlbGVtZW50JzpcbiAgICAgICAgdmFyIGNoaWxkcmVuID0gbm9kZS5jaGlsZHJlblxuICAgICAgICB2YXIgYXR0cmlidXRlcyA9IG5vZGUuYXR0cmlidXRlc1xuICAgICAgICB2YXIgdGFnTmFtZSA9IG5vZGUudHlwZVxuICAgICAgICB2YXIgaW5uZXJIVE1MID0gYXR0cmlidXRlcy5pbm5lckhUTUxcbiAgICAgICAgdmFyIHN0ciA9ICc8JyArIHRhZ05hbWUgKyBhdHRycyhhdHRyaWJ1dGVzKSArICc+J1xuXG4gICAgICAgIGlmIChpbm5lckhUTUwpIHtcbiAgICAgICAgICBzdHIgKz0gaW5uZXJIVE1MXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZm9yICh2YXIgaSA9IDAsIG4gPSBjaGlsZHJlbi5sZW5ndGg7IGkgPCBuOyBpKyspIHtcbiAgICAgICAgICAgIHN0ciArPSBzdHJpbmdpZnlOb2RlKGNoaWxkcmVuW2ldLCBwYXRoICsgJy4nICsgaSlcbiAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICBzdHIgKz0gJzwvJyArIHRhZ05hbWUgKyAnPidcbiAgICAgICAgcmV0dXJuIHN0clxuICAgICAgY2FzZSAnY29tcG9uZW50JzogcmV0dXJuIHN0cmluZ2lmeShub2RlLnR5cGUsIG5vZGUuYXR0cmlidXRlcywgbm9kZS5jaGlsZHJlbilcbiAgICB9XG5cbiAgICB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgdHlwZScpXG4gIH1cblxuICByZXR1cm4gc3RyaW5naWZ5Tm9kZShhcHAuZWxlbWVudCwgJzAnKVxufVxuXG4vKipcbiAqIEhUTUwgYXR0cmlidXRlcyB0byBzdHJpbmcuXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IGF0dHJpYnV0ZXNcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGF0dHJzIChhdHRyaWJ1dGVzKSB7XG4gIHZhciBzdHIgPSAnJ1xuICBmb3IgKHZhciBrZXkgaW4gYXR0cmlidXRlcykge1xuICAgIHZhciB2YWx1ZSA9IGF0dHJpYnV0ZXNba2V5XVxuICAgIGlmIChrZXkgPT09ICdpbm5lckhUTUwnKSBjb250aW51ZVxuICAgIGlmIChpc1ZhbGlkQXR0cmlidXRlVmFsdWUodmFsdWUpKSBzdHIgKz0gYXR0cihrZXksIGF0dHJpYnV0ZXNba2V5XSlcbiAgfVxuICByZXR1cm4gc3RyXG59XG5cbi8qKlxuICogSFRNTCBhdHRyaWJ1dGUgdG8gc3RyaW5nLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBrZXlcbiAqIEBwYXJhbSB7U3RyaW5nfSB2YWxcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIGF0dHIgKGtleSwgdmFsKSB7XG4gIHJldHVybiAnICcgKyBrZXkgKyAnPVwiJyArIHZhbCArICdcIidcbn1cblxuLyoqXG4gKiBJcyBhIHZhbHVlIGFibGUgdG8gYmUgc2V0IGEgYW4gYXR0cmlidXRlIHZhbHVlP1xuICpcbiAqIEBwYXJhbSB7QW55fSB2YWx1ZVxuICpcbiAqIEByZXR1cm4ge0Jvb2xlYW59XG4gKi9cblxuZnVuY3Rpb24gaXNWYWxpZEF0dHJpYnV0ZVZhbHVlICh2YWx1ZSkge1xuICB2YXIgdmFsdWVUeXBlID0gdHlwZSh2YWx1ZSlcbiAgc3dpdGNoICh2YWx1ZVR5cGUpIHtcbiAgY2FzZSAnc3RyaW5nJzpcbiAgY2FzZSAnbnVtYmVyJzpcbiAgICByZXR1cm4gdHJ1ZTtcblxuICBjYXNlICdib29sZWFuJzpcbiAgICByZXR1cm4gdmFsdWU7XG5cbiAgZGVmYXVsdDpcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbn1cbiIsIm1vZHVsZS5leHBvcnRzID0ge1xuICBpc0VsZW1lbnQ6IHJlcXVpcmUoJ2lzLXN2Zy1lbGVtZW50JykuaXNFbGVtZW50LFxuICBpc0F0dHJpYnV0ZTogcmVxdWlyZSgnaXMtc3ZnLWF0dHJpYnV0ZScpLFxuICBuYW1lc3BhY2U6ICdodHRwOi8vd3d3LnczLm9yZy8yMDAwL3N2Zydcbn1cbiIsIlxuLyoqXG4gKiBFeHBvc2UgYEVtaXR0ZXJgLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gRW1pdHRlcjtcblxuLyoqXG4gKiBJbml0aWFsaXplIGEgbmV3IGBFbWl0dGVyYC5cbiAqXG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbmZ1bmN0aW9uIEVtaXR0ZXIob2JqKSB7XG4gIGlmIChvYmopIHJldHVybiBtaXhpbihvYmopO1xufTtcblxuLyoqXG4gKiBNaXhpbiB0aGUgZW1pdHRlciBwcm9wZXJ0aWVzLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBvYmpcbiAqIEByZXR1cm4ge09iamVjdH1cbiAqIEBhcGkgcHJpdmF0ZVxuICovXG5cbmZ1bmN0aW9uIG1peGluKG9iaikge1xuICBmb3IgKHZhciBrZXkgaW4gRW1pdHRlci5wcm90b3R5cGUpIHtcbiAgICBvYmpba2V5XSA9IEVtaXR0ZXIucHJvdG90eXBlW2tleV07XG4gIH1cbiAgcmV0dXJuIG9iajtcbn1cblxuLyoqXG4gKiBMaXN0ZW4gb24gdGhlIGdpdmVuIGBldmVudGAgd2l0aCBgZm5gLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge0VtaXR0ZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLm9uID1cbkVtaXR0ZXIucHJvdG90eXBlLmFkZEV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbihldmVudCwgZm4pe1xuICB0aGlzLl9jYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3MgfHwge307XG4gICh0aGlzLl9jYWxsYmFja3NbJyQnICsgZXZlbnRdID0gdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XSB8fCBbXSlcbiAgICAucHVzaChmbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBBZGRzIGFuIGBldmVudGAgbGlzdGVuZXIgdGhhdCB3aWxsIGJlIGludm9rZWQgYSBzaW5nbGVcbiAqIHRpbWUgdGhlbiBhdXRvbWF0aWNhbGx5IHJlbW92ZWQuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7RW1pdHRlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUub25jZSA9IGZ1bmN0aW9uKGV2ZW50LCBmbil7XG4gIGZ1bmN0aW9uIG9uKCkge1xuICAgIHRoaXMub2ZmKGV2ZW50LCBvbik7XG4gICAgZm4uYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgfVxuXG4gIG9uLmZuID0gZm47XG4gIHRoaXMub24oZXZlbnQsIG9uKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFJlbW92ZSB0aGUgZ2l2ZW4gY2FsbGJhY2sgZm9yIGBldmVudGAgb3IgYWxsXG4gKiByZWdpc3RlcmVkIGNhbGxiYWNrcy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5vZmYgPVxuRW1pdHRlci5wcm90b3R5cGUucmVtb3ZlTGlzdGVuZXIgPVxuRW1pdHRlci5wcm90b3R5cGUucmVtb3ZlQWxsTGlzdGVuZXJzID1cbkVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUV2ZW50TGlzdGVuZXIgPSBmdW5jdGlvbihldmVudCwgZm4pe1xuICB0aGlzLl9jYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3MgfHwge307XG5cbiAgLy8gYWxsXG4gIGlmICgwID09IGFyZ3VtZW50cy5sZW5ndGgpIHtcbiAgICB0aGlzLl9jYWxsYmFja3MgPSB7fTtcbiAgICByZXR1cm4gdGhpcztcbiAgfVxuXG4gIC8vIHNwZWNpZmljIGV2ZW50XG4gIHZhciBjYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3NbJyQnICsgZXZlbnRdO1xuICBpZiAoIWNhbGxiYWNrcykgcmV0dXJuIHRoaXM7XG5cbiAgLy8gcmVtb3ZlIGFsbCBoYW5kbGVyc1xuICBpZiAoMSA9PSBhcmd1bWVudHMubGVuZ3RoKSB7XG4gICAgZGVsZXRlIHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF07XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyByZW1vdmUgc3BlY2lmaWMgaGFuZGxlclxuICB2YXIgY2I7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgY2FsbGJhY2tzLmxlbmd0aDsgaSsrKSB7XG4gICAgY2IgPSBjYWxsYmFja3NbaV07XG4gICAgaWYgKGNiID09PSBmbiB8fCBjYi5mbiA9PT0gZm4pIHtcbiAgICAgIGNhbGxiYWNrcy5zcGxpY2UoaSwgMSk7XG4gICAgICBicmVhaztcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIEVtaXQgYGV2ZW50YCB3aXRoIHRoZSBnaXZlbiBhcmdzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHBhcmFtIHtNaXhlZH0gLi4uXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLmVtaXQgPSBmdW5jdGlvbihldmVudCl7XG4gIHRoaXMuX2NhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrcyB8fCB7fTtcbiAgdmFyIGFyZ3MgPSBbXS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMSlcbiAgICAsIGNhbGxiYWNrcyA9IHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF07XG5cbiAgaWYgKGNhbGxiYWNrcykge1xuICAgIGNhbGxiYWNrcyA9IGNhbGxiYWNrcy5zbGljZSgwKTtcbiAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gY2FsbGJhY2tzLmxlbmd0aDsgaSA8IGxlbjsgKytpKSB7XG4gICAgICBjYWxsYmFja3NbaV0uYXBwbHkodGhpcywgYXJncyk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG4vKipcbiAqIFJldHVybiBhcnJheSBvZiBjYWxsYmFja3MgZm9yIGBldmVudGAuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcmV0dXJuIHtBcnJheX1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUubGlzdGVuZXJzID0gZnVuY3Rpb24oZXZlbnQpe1xuICB0aGlzLl9jYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3MgfHwge307XG4gIHJldHVybiB0aGlzLl9jYWxsYmFja3NbJyQnICsgZXZlbnRdIHx8IFtdO1xufTtcblxuLyoqXG4gKiBDaGVjayBpZiB0aGlzIGVtaXR0ZXIgaGFzIGBldmVudGAgaGFuZGxlcnMuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5oYXNMaXN0ZW5lcnMgPSBmdW5jdGlvbihldmVudCl7XG4gIHJldHVybiAhISB0aGlzLmxpc3RlbmVycyhldmVudCkubGVuZ3RoO1xufTtcbiIsIi8qKlxuICogRXhwb3NlIGByZXF1ZXN0QW5pbWF0aW9uRnJhbWUoKWAuXG4gKi9cblxuZXhwb3J0cyA9IG1vZHVsZS5leHBvcnRzID0gd2luZG93LnJlcXVlc3RBbmltYXRpb25GcmFtZVxuICB8fCB3aW5kb3cud2Via2l0UmVxdWVzdEFuaW1hdGlvbkZyYW1lXG4gIHx8IHdpbmRvdy5tb3pSZXF1ZXN0QW5pbWF0aW9uRnJhbWVcbiAgfHwgZmFsbGJhY2s7XG5cbi8qKlxuICogRmFsbGJhY2sgaW1wbGVtZW50YXRpb24uXG4gKi9cblxudmFyIHByZXYgPSBuZXcgRGF0ZSgpLmdldFRpbWUoKTtcbmZ1bmN0aW9uIGZhbGxiYWNrKGZuKSB7XG4gIHZhciBjdXJyID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG4gIHZhciBtcyA9IE1hdGgubWF4KDAsIDE2IC0gKGN1cnIgLSBwcmV2KSk7XG4gIHZhciByZXEgPSBzZXRUaW1lb3V0KGZuLCBtcyk7XG4gIHByZXYgPSBjdXJyO1xuICByZXR1cm4gcmVxO1xufVxuXG4vKipcbiAqIENhbmNlbC5cbiAqL1xuXG52YXIgY2FuY2VsID0gd2luZG93LmNhbmNlbEFuaW1hdGlvbkZyYW1lXG4gIHx8IHdpbmRvdy53ZWJraXRDYW5jZWxBbmltYXRpb25GcmFtZVxuICB8fCB3aW5kb3cubW96Q2FuY2VsQW5pbWF0aW9uRnJhbWVcbiAgfHwgd2luZG93LmNsZWFyVGltZW91dDtcblxuZXhwb3J0cy5jYW5jZWwgPSBmdW5jdGlvbihpZCl7XG4gIGNhbmNlbC5jYWxsKHdpbmRvdywgaWQpO1xufTtcbiIsIi8qKlxuICogdG9TdHJpbmcgcmVmLlxuICovXG5cbnZhciB0b1N0cmluZyA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmc7XG5cbi8qKlxuICogUmV0dXJuIHRoZSB0eXBlIG9mIGB2YWxgLlxuICpcbiAqIEBwYXJhbSB7TWl4ZWR9IHZhbFxuICogQHJldHVybiB7U3RyaW5nfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHZhbCl7XG4gIHN3aXRjaCAodG9TdHJpbmcuY2FsbCh2YWwpKSB7XG4gICAgY2FzZSAnW29iamVjdCBEYXRlXSc6IHJldHVybiAnZGF0ZSc7XG4gICAgY2FzZSAnW29iamVjdCBSZWdFeHBdJzogcmV0dXJuICdyZWdleHAnO1xuICAgIGNhc2UgJ1tvYmplY3QgQXJndW1lbnRzXSc6IHJldHVybiAnYXJndW1lbnRzJztcbiAgICBjYXNlICdbb2JqZWN0IEFycmF5XSc6IHJldHVybiAnYXJyYXknO1xuICAgIGNhc2UgJ1tvYmplY3QgRXJyb3JdJzogcmV0dXJuICdlcnJvcic7XG4gIH1cblxuICBpZiAodmFsID09PSBudWxsKSByZXR1cm4gJ251bGwnO1xuICBpZiAodmFsID09PSB1bmRlZmluZWQpIHJldHVybiAndW5kZWZpbmVkJztcbiAgaWYgKHZhbCAhPT0gdmFsKSByZXR1cm4gJ25hbic7XG4gIGlmICh2YWwgJiYgdmFsLm5vZGVUeXBlID09PSAxKSByZXR1cm4gJ2VsZW1lbnQnO1xuXG4gIGlmICh0eXBlb2YgQnVmZmVyICE9ICd1bmRlZmluZWQnICYmIEJ1ZmZlci5pc0J1ZmZlcih2YWwpKSByZXR1cm4gJ2J1ZmZlcic7XG5cbiAgdmFsID0gdmFsLnZhbHVlT2ZcbiAgICA/IHZhbC52YWx1ZU9mKClcbiAgICA6IE9iamVjdC5wcm90b3R5cGUudmFsdWVPZi5hcHBseSh2YWwpXG5cbiAgcmV0dXJuIHR5cGVvZiB2YWw7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgYmluZEludGVybmFsMyA9IHJlcXVpcmUoJy4uL2Z1bmN0aW9uL2JpbmRJbnRlcm5hbDMnKTtcblxuLyoqXG4gKiAjIEZvciBFYWNoXG4gKlxuICogQSBmYXN0IGAuZm9yRWFjaCgpYCBpbXBsZW1lbnRhdGlvbi5cbiAqXG4gKiBAcGFyYW0gIHtBcnJheX0gICAgc3ViamVjdCAgICAgVGhlIGFycmF5IChvciBhcnJheS1saWtlKSB0byBpdGVyYXRlIG92ZXIuXG4gKiBAcGFyYW0gIHtGdW5jdGlvbn0gZm4gICAgICAgICAgVGhlIHZpc2l0b3IgZnVuY3Rpb24uXG4gKiBAcGFyYW0gIHtPYmplY3R9ICAgdGhpc0NvbnRleHQgVGhlIGNvbnRleHQgZm9yIHRoZSB2aXNpdG9yLlxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGZhc3RGb3JFYWNoIChzdWJqZWN0LCBmbiwgdGhpc0NvbnRleHQpIHtcbiAgdmFyIGxlbmd0aCA9IHN1YmplY3QubGVuZ3RoLFxuICAgICAgaXRlcmF0b3IgPSB0aGlzQ29udGV4dCAhPT0gdW5kZWZpbmVkID8gYmluZEludGVybmFsMyhmbiwgdGhpc0NvbnRleHQpIDogZm4sXG4gICAgICBpO1xuICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBpdGVyYXRvcihzdWJqZWN0W2ldLCBpLCBzdWJqZWN0KTtcbiAgfVxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGJpbmRJbnRlcm5hbDQgPSByZXF1aXJlKCcuLi9mdW5jdGlvbi9iaW5kSW50ZXJuYWw0Jyk7XG5cbi8qKlxuICogIyBSZWR1Y2VcbiAqXG4gKiBBIGZhc3QgYC5yZWR1Y2UoKWAgaW1wbGVtZW50YXRpb24uXG4gKlxuICogQHBhcmFtICB7QXJyYXl9ICAgIHN1YmplY3QgICAgICBUaGUgYXJyYXkgKG9yIGFycmF5LWxpa2UpIHRvIHJlZHVjZS5cbiAqIEBwYXJhbSAge0Z1bmN0aW9ufSBmbiAgICAgICAgICAgVGhlIHJlZHVjZXIgZnVuY3Rpb24uXG4gKiBAcGFyYW0gIHttaXhlZH0gICAgaW5pdGlhbFZhbHVlIFRoZSBpbml0aWFsIHZhbHVlIGZvciB0aGUgcmVkdWNlciwgZGVmYXVsdHMgdG8gc3ViamVjdFswXS5cbiAqIEBwYXJhbSAge09iamVjdH0gICB0aGlzQ29udGV4dCAgVGhlIGNvbnRleHQgZm9yIHRoZSByZWR1Y2VyLlxuICogQHJldHVybiB7bWl4ZWR9ICAgICAgICAgICAgICAgICBUaGUgZmluYWwgcmVzdWx0LlxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGZhc3RSZWR1Y2UgKHN1YmplY3QsIGZuLCBpbml0aWFsVmFsdWUsIHRoaXNDb250ZXh0KSB7XG4gIHZhciBsZW5ndGggPSBzdWJqZWN0Lmxlbmd0aCxcbiAgICAgIGl0ZXJhdG9yID0gdGhpc0NvbnRleHQgIT09IHVuZGVmaW5lZCA/IGJpbmRJbnRlcm5hbDQoZm4sIHRoaXNDb250ZXh0KSA6IGZuLFxuICAgICAgaSwgcmVzdWx0O1xuXG4gIGlmIChpbml0aWFsVmFsdWUgPT09IHVuZGVmaW5lZCkge1xuICAgIGkgPSAxO1xuICAgIHJlc3VsdCA9IHN1YmplY3RbMF07XG4gIH1cbiAgZWxzZSB7XG4gICAgaSA9IDA7XG4gICAgcmVzdWx0ID0gaW5pdGlhbFZhbHVlO1xuICB9XG5cbiAgZm9yICg7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIHJlc3VsdCA9IGl0ZXJhdG9yKHJlc3VsdCwgc3ViamVjdFtpXSwgaSwgc3ViamVjdCk7XG4gIH1cblxuICByZXR1cm4gcmVzdWx0O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGZvckVhY2hBcnJheSA9IHJlcXVpcmUoJy4vYXJyYXkvZm9yRWFjaCcpLFxuICAgIGZvckVhY2hPYmplY3QgPSByZXF1aXJlKCcuL29iamVjdC9mb3JFYWNoJyk7XG5cbi8qKlxuICogIyBGb3JFYWNoXG4gKlxuICogQSBmYXN0IGAuZm9yRWFjaCgpYCBpbXBsZW1lbnRhdGlvbi5cbiAqXG4gKiBAcGFyYW0gIHtBcnJheXxPYmplY3R9IHN1YmplY3QgICAgIFRoZSBhcnJheSBvciBvYmplY3QgdG8gaXRlcmF0ZSBvdmVyLlxuICogQHBhcmFtICB7RnVuY3Rpb259ICAgICBmbiAgICAgICAgICBUaGUgdmlzaXRvciBmdW5jdGlvbi5cbiAqIEBwYXJhbSAge09iamVjdH0gICAgICAgdGhpc0NvbnRleHQgVGhlIGNvbnRleHQgZm9yIHRoZSB2aXNpdG9yLlxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGZhc3RGb3JFYWNoIChzdWJqZWN0LCBmbiwgdGhpc0NvbnRleHQpIHtcbiAgaWYgKHN1YmplY3QgaW5zdGFuY2VvZiBBcnJheSkge1xuICAgIHJldHVybiBmb3JFYWNoQXJyYXkoc3ViamVjdCwgZm4sIHRoaXNDb250ZXh0KTtcbiAgfVxuICBlbHNlIHtcbiAgICByZXR1cm4gZm9yRWFjaE9iamVjdChzdWJqZWN0LCBmbiwgdGhpc0NvbnRleHQpO1xuICB9XG59OyIsIid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiBJbnRlcm5hbCBoZWxwZXIgdG8gYmluZCBhIGZ1bmN0aW9uIGtub3duIHRvIGhhdmUgMyBhcmd1bWVudHNcbiAqIHRvIGEgZ2l2ZW4gY29udGV4dC5cbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBiaW5kSW50ZXJuYWwzIChmdW5jLCB0aGlzQ29udGV4dCkge1xuICByZXR1cm4gZnVuY3Rpb24gKGEsIGIsIGMpIHtcbiAgICByZXR1cm4gZnVuYy5jYWxsKHRoaXNDb250ZXh0LCBhLCBiLCBjKTtcbiAgfTtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbi8qKlxuICogSW50ZXJuYWwgaGVscGVyIHRvIGJpbmQgYSBmdW5jdGlvbiBrbm93biB0byBoYXZlIDQgYXJndW1lbnRzXG4gKiB0byBhIGdpdmVuIGNvbnRleHQuXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gYmluZEludGVybmFsNCAoZnVuYywgdGhpc0NvbnRleHQpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIChhLCBiLCBjLCBkKSB7XG4gICAgcmV0dXJuIGZ1bmMuY2FsbCh0aGlzQ29udGV4dCwgYSwgYiwgYywgZCk7XG4gIH07XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIEFuYWxvZ3VlIG9mIE9iamVjdC5hc3NpZ24oKS5cbiAqIENvcGllcyBwcm9wZXJ0aWVzIGZyb20gb25lIG9yIG1vcmUgc291cmNlIG9iamVjdHMgdG9cbiAqIGEgdGFyZ2V0IG9iamVjdC4gRXhpc3Rpbmcga2V5cyBvbiB0aGUgdGFyZ2V0IG9iamVjdCB3aWxsIGJlIG92ZXJ3cml0dGVuLlxuICpcbiAqID4gTm90ZTogVGhpcyBkaWZmZXJzIGZyb20gc3BlYyBpbiBzb21lIGltcG9ydGFudCB3YXlzOlxuICogPiAxLiBXaWxsIHRocm93IGlmIHBhc3NlZCBub24tb2JqZWN0cywgaW5jbHVkaW5nIGB1bmRlZmluZWRgIG9yIGBudWxsYCB2YWx1ZXMuXG4gKiA+IDIuIERvZXMgbm90IHN1cHBvcnQgdGhlIGN1cmlvdXMgRXhjZXB0aW9uIGhhbmRsaW5nIGJlaGF2aW9yLCBleGNlcHRpb25zIGFyZSB0aHJvd24gaW1tZWRpYXRlbHkuXG4gKiA+IEZvciBtb3JlIGRldGFpbHMsIHNlZTpcbiAqID4gaHR0cHM6Ly9kZXZlbG9wZXIubW96aWxsYS5vcmcvZW4tVVMvZG9jcy9XZWIvSmF2YVNjcmlwdC9SZWZlcmVuY2UvR2xvYmFsX09iamVjdHMvT2JqZWN0L2Fzc2lnblxuICpcbiAqXG4gKlxuICogQHBhcmFtICB7T2JqZWN0fSB0YXJnZXQgICAgICBUaGUgdGFyZ2V0IG9iamVjdCB0byBjb3B5IHByb3BlcnRpZXMgdG8uXG4gKiBAcGFyYW0gIHtPYmplY3R9IHNvdXJjZSwgLi4uIFRoZSBzb3VyY2UocykgdG8gY29weSBwcm9wZXJ0aWVzIGZyb20uXG4gKiBAcmV0dXJuIHtPYmplY3R9ICAgICAgICAgICAgIFRoZSB1cGRhdGVkIHRhcmdldCBvYmplY3QuXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZmFzdEFzc2lnbiAodGFyZ2V0KSB7XG4gIHZhciB0b3RhbEFyZ3MgPSBhcmd1bWVudHMubGVuZ3RoLFxuICAgICAgc291cmNlLCBpLCB0b3RhbEtleXMsIGtleXMsIGtleSwgajtcblxuICBmb3IgKGkgPSAxOyBpIDwgdG90YWxBcmdzOyBpKyspIHtcbiAgICBzb3VyY2UgPSBhcmd1bWVudHNbaV07XG4gICAga2V5cyA9IE9iamVjdC5rZXlzKHNvdXJjZSk7XG4gICAgdG90YWxLZXlzID0ga2V5cy5sZW5ndGg7XG4gICAgZm9yIChqID0gMDsgaiA8IHRvdGFsS2V5czsgaisrKSB7XG4gICAgICBrZXkgPSBrZXlzW2pdO1xuICAgICAgdGFyZ2V0W2tleV0gPSBzb3VyY2Vba2V5XTtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHRhcmdldDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBiaW5kSW50ZXJuYWwzID0gcmVxdWlyZSgnLi4vZnVuY3Rpb24vYmluZEludGVybmFsMycpO1xuXG4vKipcbiAqICMgRm9yIEVhY2hcbiAqXG4gKiBBIGZhc3Qgb2JqZWN0IGAuZm9yRWFjaCgpYCBpbXBsZW1lbnRhdGlvbi5cbiAqXG4gKiBAcGFyYW0gIHtPYmplY3R9ICAgc3ViamVjdCAgICAgVGhlIG9iamVjdCB0byBpdGVyYXRlIG92ZXIuXG4gKiBAcGFyYW0gIHtGdW5jdGlvbn0gZm4gICAgICAgICAgVGhlIHZpc2l0b3IgZnVuY3Rpb24uXG4gKiBAcGFyYW0gIHtPYmplY3R9ICAgdGhpc0NvbnRleHQgVGhlIGNvbnRleHQgZm9yIHRoZSB2aXNpdG9yLlxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGZhc3RGb3JFYWNoT2JqZWN0IChzdWJqZWN0LCBmbiwgdGhpc0NvbnRleHQpIHtcbiAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhzdWJqZWN0KSxcbiAgICAgIGxlbmd0aCA9IGtleXMubGVuZ3RoLFxuICAgICAgaXRlcmF0b3IgPSB0aGlzQ29udGV4dCAhPT0gdW5kZWZpbmVkID8gYmluZEludGVybmFsMyhmbiwgdGhpc0NvbnRleHQpIDogZm4sXG4gICAgICBrZXksIGk7XG4gIGZvciAoaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGtleSA9IGtleXNbaV07XG4gICAgaXRlcmF0b3Ioc3ViamVjdFtrZXldLCBrZXksIHN1YmplY3QpO1xuICB9XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgYmluZEludGVybmFsNCA9IHJlcXVpcmUoJy4uL2Z1bmN0aW9uL2JpbmRJbnRlcm5hbDQnKTtcblxuLyoqXG4gKiAjIFJlZHVjZVxuICpcbiAqIEEgZmFzdCBvYmplY3QgYC5yZWR1Y2UoKWAgaW1wbGVtZW50YXRpb24uXG4gKlxuICogQHBhcmFtICB7T2JqZWN0fSAgIHN1YmplY3QgICAgICBUaGUgb2JqZWN0IHRvIHJlZHVjZSBvdmVyLlxuICogQHBhcmFtICB7RnVuY3Rpb259IGZuICAgICAgICAgICBUaGUgcmVkdWNlciBmdW5jdGlvbi5cbiAqIEBwYXJhbSAge21peGVkfSAgICBpbml0aWFsVmFsdWUgVGhlIGluaXRpYWwgdmFsdWUgZm9yIHRoZSByZWR1Y2VyLCBkZWZhdWx0cyB0byBzdWJqZWN0WzBdLlxuICogQHBhcmFtICB7T2JqZWN0fSAgIHRoaXNDb250ZXh0ICBUaGUgY29udGV4dCBmb3IgdGhlIHJlZHVjZXIuXG4gKiBAcmV0dXJuIHttaXhlZH0gICAgICAgICAgICAgICAgIFRoZSBmaW5hbCByZXN1bHQuXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZmFzdFJlZHVjZU9iamVjdCAoc3ViamVjdCwgZm4sIGluaXRpYWxWYWx1ZSwgdGhpc0NvbnRleHQpIHtcbiAgdmFyIGtleXMgPSBPYmplY3Qua2V5cyhzdWJqZWN0KSxcbiAgICAgIGxlbmd0aCA9IGtleXMubGVuZ3RoLFxuICAgICAgaXRlcmF0b3IgPSB0aGlzQ29udGV4dCAhPT0gdW5kZWZpbmVkID8gYmluZEludGVybmFsNChmbiwgdGhpc0NvbnRleHQpIDogZm4sXG4gICAgICBpLCBrZXksIHJlc3VsdDtcblxuICBpZiAoaW5pdGlhbFZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICBpID0gMTtcbiAgICByZXN1bHQgPSBzdWJqZWN0W2tleXNbMF1dO1xuICB9XG4gIGVsc2Uge1xuICAgIGkgPSAwO1xuICAgIHJlc3VsdCA9IGluaXRpYWxWYWx1ZTtcbiAgfVxuXG4gIGZvciAoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBrZXkgPSBrZXlzW2ldO1xuICAgIHJlc3VsdCA9IGl0ZXJhdG9yKHJlc3VsdCwgc3ViamVjdFtrZXldLCBrZXksIHN1YmplY3QpO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciByZWR1Y2VBcnJheSA9IHJlcXVpcmUoJy4vYXJyYXkvcmVkdWNlJyksXG4gICAgcmVkdWNlT2JqZWN0ID0gcmVxdWlyZSgnLi9vYmplY3QvcmVkdWNlJyk7XG5cbi8qKlxuICogIyBSZWR1Y2VcbiAqXG4gKiBBIGZhc3QgYC5yZWR1Y2UoKWAgaW1wbGVtZW50YXRpb24uXG4gKlxuICogQHBhcmFtICB7QXJyYXl8T2JqZWN0fSBzdWJqZWN0ICAgICAgVGhlIGFycmF5IG9yIG9iamVjdCB0byByZWR1Y2Ugb3Zlci5cbiAqIEBwYXJhbSAge0Z1bmN0aW9ufSAgICAgZm4gICAgICAgICAgIFRoZSByZWR1Y2VyIGZ1bmN0aW9uLlxuICogQHBhcmFtICB7bWl4ZWR9ICAgICAgICBpbml0aWFsVmFsdWUgVGhlIGluaXRpYWwgdmFsdWUgZm9yIHRoZSByZWR1Y2VyLCBkZWZhdWx0cyB0byBzdWJqZWN0WzBdLlxuICogQHBhcmFtICB7T2JqZWN0fSAgICAgICB0aGlzQ29udGV4dCAgVGhlIGNvbnRleHQgZm9yIHRoZSByZWR1Y2VyLlxuICogQHJldHVybiB7QXJyYXl8T2JqZWN0fSAgICAgICAgICAgICAgVGhlIGFycmF5IG9yIG9iamVjdCBjb250YWluaW5nIHRoZSByZXN1bHRzLlxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGZhc3RSZWR1Y2UgKHN1YmplY3QsIGZuLCBpbml0aWFsVmFsdWUsIHRoaXNDb250ZXh0KSB7XG4gIGlmIChzdWJqZWN0IGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICByZXR1cm4gcmVkdWNlQXJyYXkoc3ViamVjdCwgZm4sIGluaXRpYWxWYWx1ZSwgdGhpc0NvbnRleHQpO1xuICB9XG4gIGVsc2Uge1xuICAgIHJldHVybiByZWR1Y2VPYmplY3Qoc3ViamVjdCwgZm4sIGluaXRpYWxWYWx1ZSwgdGhpc0NvbnRleHQpO1xuICB9XG59OyIsIi8qKiBnZW5lcmF0ZSB1bmlxdWUgaWQgZm9yIHNlbGVjdG9yICovXHJcbnZhciBjb3VudGVyID0gRGF0ZS5ub3coKSAlIDFlOTtcclxuXHJcbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZ2V0VWlkKCl7XHJcblx0cmV0dXJuIChNYXRoLnJhbmRvbSgpICogMWU5ID4+PiAwKSArIChjb3VudGVyKyspO1xyXG59OyIsIi8qZ2xvYmFsIHdpbmRvdyovXG5cbi8qKlxuICogQ2hlY2sgaWYgb2JqZWN0IGlzIGRvbSBub2RlLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSB2YWxcbiAqIEByZXR1cm4ge0Jvb2xlYW59XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gaXNOb2RlKHZhbCl7XG4gIGlmICghdmFsIHx8IHR5cGVvZiB2YWwgIT09ICdvYmplY3QnKSByZXR1cm4gZmFsc2U7XG4gIGlmICh3aW5kb3cgJiYgJ29iamVjdCcgPT0gdHlwZW9mIHdpbmRvdy5Ob2RlKSByZXR1cm4gdmFsIGluc3RhbmNlb2Ygd2luZG93Lk5vZGU7XG4gIHJldHVybiAnbnVtYmVyJyA9PSB0eXBlb2YgdmFsLm5vZGVUeXBlICYmICdzdHJpbmcnID09IHR5cGVvZiB2YWwubm9kZU5hbWU7XG59XG4iLCIvKipcbiAqIFN1cHBvcnRlZCBTVkcgYXR0cmlidXRlc1xuICovXG5cbmV4cG9ydHMuYXR0cmlidXRlcyA9IHtcbiAgJ2N4JzogdHJ1ZSxcbiAgJ2N5JzogdHJ1ZSxcbiAgJ2QnOiB0cnVlLFxuICAnZHgnOiB0cnVlLFxuICAnZHknOiB0cnVlLFxuICAnZmlsbCc6IHRydWUsXG4gICdmaWxsT3BhY2l0eSc6IHRydWUsXG4gICdmb250RmFtaWx5JzogdHJ1ZSxcbiAgJ2ZvbnRTaXplJzogdHJ1ZSxcbiAgJ2Z4JzogdHJ1ZSxcbiAgJ2Z5JzogdHJ1ZSxcbiAgJ2dyYWRpZW50VHJhbnNmb3JtJzogdHJ1ZSxcbiAgJ2dyYWRpZW50VW5pdHMnOiB0cnVlLFxuICAnbWFya2VyRW5kJzogdHJ1ZSxcbiAgJ21hcmtlck1pZCc6IHRydWUsXG4gICdtYXJrZXJTdGFydCc6IHRydWUsXG4gICdvZmZzZXQnOiB0cnVlLFxuICAnb3BhY2l0eSc6IHRydWUsXG4gICdwYXR0ZXJuQ29udGVudFVuaXRzJzogdHJ1ZSxcbiAgJ3BhdHRlcm5Vbml0cyc6IHRydWUsXG4gICdwb2ludHMnOiB0cnVlLFxuICAncHJlc2VydmVBc3BlY3RSYXRpbyc6IHRydWUsXG4gICdyJzogdHJ1ZSxcbiAgJ3J4JzogdHJ1ZSxcbiAgJ3J5JzogdHJ1ZSxcbiAgJ3NwcmVhZE1ldGhvZCc6IHRydWUsXG4gICdzdG9wQ29sb3InOiB0cnVlLFxuICAnc3RvcE9wYWNpdHknOiB0cnVlLFxuICAnc3Ryb2tlJzogdHJ1ZSxcbiAgJ3N0cm9rZURhc2hhcnJheSc6IHRydWUsXG4gICdzdHJva2VMaW5lY2FwJzogdHJ1ZSxcbiAgJ3N0cm9rZU9wYWNpdHknOiB0cnVlLFxuICAnc3Ryb2tlV2lkdGgnOiB0cnVlLFxuICAndGV4dEFuY2hvcic6IHRydWUsXG4gICd0cmFuc2Zvcm0nOiB0cnVlLFxuICAndmVyc2lvbic6IHRydWUsXG4gICd2aWV3Qm94JzogdHJ1ZSxcbiAgJ3gxJzogdHJ1ZSxcbiAgJ3gyJzogdHJ1ZSxcbiAgJ3gnOiB0cnVlLFxuICAneTEnOiB0cnVlLFxuICAneTInOiB0cnVlLFxuICAneSc6IHRydWVcbn1cblxuLyoqXG4gKiBBcmUgZWxlbWVudCdzIGF0dHJpYnV0ZXMgU1ZHP1xuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBhdHRyXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoYXR0cikge1xuICByZXR1cm4gYXR0ciBpbiBleHBvcnRzLmF0dHJpYnV0ZXNcbn1cbiIsIi8qKlxuICogU3VwcG9ydGVkIFNWRyBlbGVtZW50c1xuICpcbiAqIEB0eXBlIHtBcnJheX1cbiAqL1xuXG5leHBvcnRzLmVsZW1lbnRzID0ge1xuICAnYW5pbWF0ZSc6IHRydWUsXG4gICdjaXJjbGUnOiB0cnVlLFxuICAnZGVmcyc6IHRydWUsXG4gICdlbGxpcHNlJzogdHJ1ZSxcbiAgJ2cnOiB0cnVlLFxuICAnbGluZSc6IHRydWUsXG4gICdsaW5lYXJHcmFkaWVudCc6IHRydWUsXG4gICdtYXNrJzogdHJ1ZSxcbiAgJ3BhdGgnOiB0cnVlLFxuICAncGF0dGVybic6IHRydWUsXG4gICdwb2x5Z29uJzogdHJ1ZSxcbiAgJ3BvbHlsaW5lJzogdHJ1ZSxcbiAgJ3JhZGlhbEdyYWRpZW50JzogdHJ1ZSxcbiAgJ3JlY3QnOiB0cnVlLFxuICAnc3RvcCc6IHRydWUsXG4gICdzdmcnOiB0cnVlLFxuICAndGV4dCc6IHRydWUsXG4gICd0c3Bhbic6IHRydWVcbn1cblxuLyoqXG4gKiBJcyBlbGVtZW50J3MgbmFtZXNwYWNlIFNWRz9cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gbmFtZVxuICovXG5cbmV4cG9ydHMuaXNFbGVtZW50ID0gZnVuY3Rpb24gKG5hbWUpIHtcbiAgcmV0dXJuIG5hbWUgaW4gZXhwb3J0cy5lbGVtZW50c1xufVxuIiwiJ3VzZSBzdHJpY3QnXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24odGFyZ2V0KSB7XG4gIHRhcmdldCA9IHRhcmdldCB8fCB7fVxuXG4gIGZvciAodmFyIGkgPSAxOyBpIDwgYXJndW1lbnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIHNvdXJjZSA9IGFyZ3VtZW50c1tpXVxuICAgIGlmICghc291cmNlKSBjb250aW51ZVxuXG4gICAgT2JqZWN0LmdldE93blByb3BlcnR5TmFtZXMoc291cmNlKS5mb3JFYWNoKGZ1bmN0aW9uKGtleSkge1xuICAgICAgaWYgKHVuZGVmaW5lZCA9PT0gdGFyZ2V0W2tleV0pXG4gICAgICAgIHRhcmdldFtrZXldID0gc291cmNlW2tleV1cbiAgICB9KVxuICB9XG5cbiAgcmV0dXJuIHRhcmdldFxufVxuIiwiKGZ1bmN0aW9uIChyb290LCBmYWN0b3J5KXtcbiAgJ3VzZSBzdHJpY3QnO1xuXG4gIC8qaXN0YW5idWwgaWdub3JlIG5leHQ6Y2FudCB0ZXN0Ki9cbiAgaWYgKHR5cGVvZiBtb2R1bGUgPT09ICdvYmplY3QnICYmIHR5cGVvZiBtb2R1bGUuZXhwb3J0cyA9PT0gJ29iamVjdCcpIHtcbiAgICBtb2R1bGUuZXhwb3J0cyA9IGZhY3RvcnkoKTtcbiAgfSBlbHNlIGlmICh0eXBlb2YgZGVmaW5lID09PSAnZnVuY3Rpb24nICYmIGRlZmluZS5hbWQpIHtcbiAgICAvLyBBTUQuIFJlZ2lzdGVyIGFzIGFuIGFub255bW91cyBtb2R1bGUuXG4gICAgZGVmaW5lKFtdLCBmYWN0b3J5KTtcbiAgfSBlbHNlIHtcbiAgICAvLyBCcm93c2VyIGdsb2JhbHNcbiAgICByb290Lm9iamVjdFBhdGggPSBmYWN0b3J5KCk7XG4gIH1cbn0pKHRoaXMsIGZ1bmN0aW9uKCl7XG4gICd1c2Ugc3RyaWN0JztcblxuICB2YXJcbiAgICB0b1N0ciA9IE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcsXG4gICAgX2hhc093blByb3BlcnR5ID0gT2JqZWN0LnByb3RvdHlwZS5oYXNPd25Qcm9wZXJ0eTtcblxuICBmdW5jdGlvbiBpc0VtcHR5KHZhbHVlKXtcbiAgICBpZiAoIXZhbHVlKSB7XG4gICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgaWYgKGlzQXJyYXkodmFsdWUpICYmIHZhbHVlLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9IGVsc2UgaWYgKCFpc1N0cmluZyh2YWx1ZSkpIHtcbiAgICAgICAgZm9yICh2YXIgaSBpbiB2YWx1ZSkge1xuICAgICAgICAgICAgaWYgKF9oYXNPd25Qcm9wZXJ0eS5jYWxsKHZhbHVlLCBpKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG5cbiAgZnVuY3Rpb24gdG9TdHJpbmcodHlwZSl7XG4gICAgcmV0dXJuIHRvU3RyLmNhbGwodHlwZSk7XG4gIH1cblxuICBmdW5jdGlvbiBpc051bWJlcih2YWx1ZSl7XG4gICAgcmV0dXJuIHR5cGVvZiB2YWx1ZSA9PT0gJ251bWJlcicgfHwgdG9TdHJpbmcodmFsdWUpID09PSBcIltvYmplY3QgTnVtYmVyXVwiO1xuICB9XG5cbiAgZnVuY3Rpb24gaXNTdHJpbmcob2JqKXtcbiAgICByZXR1cm4gdHlwZW9mIG9iaiA9PT0gJ3N0cmluZycgfHwgdG9TdHJpbmcob2JqKSA9PT0gXCJbb2JqZWN0IFN0cmluZ11cIjtcbiAgfVxuXG4gIGZ1bmN0aW9uIGlzT2JqZWN0KG9iail7XG4gICAgcmV0dXJuIHR5cGVvZiBvYmogPT09ICdvYmplY3QnICYmIHRvU3RyaW5nKG9iaikgPT09IFwiW29iamVjdCBPYmplY3RdXCI7XG4gIH1cblxuICBmdW5jdGlvbiBpc0FycmF5KG9iail7XG4gICAgcmV0dXJuIHR5cGVvZiBvYmogPT09ICdvYmplY3QnICYmIHR5cGVvZiBvYmoubGVuZ3RoID09PSAnbnVtYmVyJyAmJiB0b1N0cmluZyhvYmopID09PSAnW29iamVjdCBBcnJheV0nO1xuICB9XG5cbiAgZnVuY3Rpb24gaXNCb29sZWFuKG9iail7XG4gICAgcmV0dXJuIHR5cGVvZiBvYmogPT09ICdib29sZWFuJyB8fCB0b1N0cmluZyhvYmopID09PSAnW29iamVjdCBCb29sZWFuXSc7XG4gIH1cblxuICBmdW5jdGlvbiBnZXRLZXkoa2V5KXtcbiAgICB2YXIgaW50S2V5ID0gcGFyc2VJbnQoa2V5KTtcbiAgICBpZiAoaW50S2V5LnRvU3RyaW5nKCkgPT09IGtleSkge1xuICAgICAgcmV0dXJuIGludEtleTtcbiAgICB9XG4gICAgcmV0dXJuIGtleTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHNldChvYmosIHBhdGgsIHZhbHVlLCBkb05vdFJlcGxhY2Upe1xuICAgIGlmIChpc051bWJlcihwYXRoKSkge1xuICAgICAgcGF0aCA9IFtwYXRoXTtcbiAgICB9XG4gICAgaWYgKGlzRW1wdHkocGF0aCkpIHtcbiAgICAgIHJldHVybiBvYmo7XG4gICAgfVxuICAgIGlmIChpc1N0cmluZyhwYXRoKSkge1xuICAgICAgcmV0dXJuIHNldChvYmosIHBhdGguc3BsaXQoJy4nKS5tYXAoZ2V0S2V5KSwgdmFsdWUsIGRvTm90UmVwbGFjZSk7XG4gICAgfVxuICAgIHZhciBjdXJyZW50UGF0aCA9IHBhdGhbMF07XG5cbiAgICBpZiAocGF0aC5sZW5ndGggPT09IDEpIHtcbiAgICAgIHZhciBvbGRWYWwgPSBvYmpbY3VycmVudFBhdGhdO1xuICAgICAgaWYgKG9sZFZhbCA9PT0gdm9pZCAwIHx8ICFkb05vdFJlcGxhY2UpIHtcbiAgICAgICAgb2JqW2N1cnJlbnRQYXRoXSA9IHZhbHVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG9sZFZhbDtcbiAgICB9XG5cbiAgICBpZiAob2JqW2N1cnJlbnRQYXRoXSA9PT0gdm9pZCAwKSB7XG4gICAgICAvL2NoZWNrIGlmIHdlIGFzc3VtZSBhbiBhcnJheVxuICAgICAgaWYoaXNOdW1iZXIocGF0aFsxXSkpIHtcbiAgICAgICAgb2JqW2N1cnJlbnRQYXRoXSA9IFtdO1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgb2JqW2N1cnJlbnRQYXRoXSA9IHt9O1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBzZXQob2JqW2N1cnJlbnRQYXRoXSwgcGF0aC5zbGljZSgxKSwgdmFsdWUsIGRvTm90UmVwbGFjZSk7XG4gIH1cblxuICBmdW5jdGlvbiBkZWwob2JqLCBwYXRoKSB7XG4gICAgaWYgKGlzTnVtYmVyKHBhdGgpKSB7XG4gICAgICBwYXRoID0gW3BhdGhdO1xuICAgIH1cblxuICAgIGlmIChpc0VtcHR5KG9iaikpIHtcbiAgICAgIHJldHVybiB2b2lkIDA7XG4gICAgfVxuXG4gICAgaWYgKGlzRW1wdHkocGF0aCkpIHtcbiAgICAgIHJldHVybiBvYmo7XG4gICAgfVxuICAgIGlmKGlzU3RyaW5nKHBhdGgpKSB7XG4gICAgICByZXR1cm4gZGVsKG9iaiwgcGF0aC5zcGxpdCgnLicpKTtcbiAgICB9XG5cbiAgICB2YXIgY3VycmVudFBhdGggPSBnZXRLZXkocGF0aFswXSk7XG4gICAgdmFyIG9sZFZhbCA9IG9ialtjdXJyZW50UGF0aF07XG5cbiAgICBpZihwYXRoLmxlbmd0aCA9PT0gMSkge1xuICAgICAgaWYgKG9sZFZhbCAhPT0gdm9pZCAwKSB7XG4gICAgICAgIGlmIChpc0FycmF5KG9iaikpIHtcbiAgICAgICAgICBvYmouc3BsaWNlKGN1cnJlbnRQYXRoLCAxKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBkZWxldGUgb2JqW2N1cnJlbnRQYXRoXTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0gZWxzZSB7XG4gICAgICBpZiAob2JqW2N1cnJlbnRQYXRoXSAhPT0gdm9pZCAwKSB7XG4gICAgICAgIHJldHVybiBkZWwob2JqW2N1cnJlbnRQYXRoXSwgcGF0aC5zbGljZSgxKSk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIG9iajtcbiAgfVxuXG4gIHZhciBvYmplY3RQYXRoID0gZnVuY3Rpb24ob2JqKSB7XG4gICAgcmV0dXJuIE9iamVjdC5rZXlzKG9iamVjdFBhdGgpLnJlZHVjZShmdW5jdGlvbihwcm94eSwgcHJvcCkge1xuICAgICAgaWYgKHR5cGVvZiBvYmplY3RQYXRoW3Byb3BdID09PSAnZnVuY3Rpb24nKSB7XG4gICAgICAgIHByb3h5W3Byb3BdID0gb2JqZWN0UGF0aFtwcm9wXS5iaW5kKG9iamVjdFBhdGgsIG9iaik7XG4gICAgICB9XG5cbiAgICAgIHJldHVybiBwcm94eTtcbiAgICB9LCB7fSk7XG4gIH07XG5cbiAgb2JqZWN0UGF0aC5oYXMgPSBmdW5jdGlvbiAob2JqLCBwYXRoKSB7XG4gICAgaWYgKGlzRW1wdHkob2JqKSkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGlmIChpc051bWJlcihwYXRoKSkge1xuICAgICAgcGF0aCA9IFtwYXRoXTtcbiAgICB9IGVsc2UgaWYgKGlzU3RyaW5nKHBhdGgpKSB7XG4gICAgICBwYXRoID0gcGF0aC5zcGxpdCgnLicpO1xuICAgIH1cblxuICAgIGlmIChpc0VtcHR5KHBhdGgpIHx8IHBhdGgubGVuZ3RoID09PSAwKSB7XG4gICAgICByZXR1cm4gZmFsc2U7XG4gICAgfVxuXG4gICAgZm9yICh2YXIgaSA9IDA7IGkgPCBwYXRoLmxlbmd0aDsgaSsrKSB7XG4gICAgICB2YXIgaiA9IHBhdGhbaV07XG4gICAgICBpZiAoKGlzT2JqZWN0KG9iaikgfHwgaXNBcnJheShvYmopKSAmJiBfaGFzT3duUHJvcGVydHkuY2FsbChvYmosIGopKSB7XG4gICAgICAgIG9iaiA9IG9ialtqXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfTtcblxuICBvYmplY3RQYXRoLmVuc3VyZUV4aXN0cyA9IGZ1bmN0aW9uIChvYmosIHBhdGgsIHZhbHVlKXtcbiAgICByZXR1cm4gc2V0KG9iaiwgcGF0aCwgdmFsdWUsIHRydWUpO1xuICB9O1xuXG4gIG9iamVjdFBhdGguc2V0ID0gZnVuY3Rpb24gKG9iaiwgcGF0aCwgdmFsdWUsIGRvTm90UmVwbGFjZSl7XG4gICAgcmV0dXJuIHNldChvYmosIHBhdGgsIHZhbHVlLCBkb05vdFJlcGxhY2UpO1xuICB9O1xuXG4gIG9iamVjdFBhdGguaW5zZXJ0ID0gZnVuY3Rpb24gKG9iaiwgcGF0aCwgdmFsdWUsIGF0KXtcbiAgICB2YXIgYXJyID0gb2JqZWN0UGF0aC5nZXQob2JqLCBwYXRoKTtcbiAgICBhdCA9IH5+YXQ7XG4gICAgaWYgKCFpc0FycmF5KGFycikpIHtcbiAgICAgIGFyciA9IFtdO1xuICAgICAgb2JqZWN0UGF0aC5zZXQob2JqLCBwYXRoLCBhcnIpO1xuICAgIH1cbiAgICBhcnIuc3BsaWNlKGF0LCAwLCB2YWx1ZSk7XG4gIH07XG5cbiAgb2JqZWN0UGF0aC5lbXB0eSA9IGZ1bmN0aW9uKG9iaiwgcGF0aCkge1xuICAgIGlmIChpc0VtcHR5KHBhdGgpKSB7XG4gICAgICByZXR1cm4gb2JqO1xuICAgIH1cbiAgICBpZiAoaXNFbXB0eShvYmopKSB7XG4gICAgICByZXR1cm4gdm9pZCAwO1xuICAgIH1cblxuICAgIHZhciB2YWx1ZSwgaTtcbiAgICBpZiAoISh2YWx1ZSA9IG9iamVjdFBhdGguZ2V0KG9iaiwgcGF0aCkpKSB7XG4gICAgICByZXR1cm4gb2JqO1xuICAgIH1cblxuICAgIGlmIChpc1N0cmluZyh2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBvYmplY3RQYXRoLnNldChvYmosIHBhdGgsICcnKTtcbiAgICB9IGVsc2UgaWYgKGlzQm9vbGVhbih2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBvYmplY3RQYXRoLnNldChvYmosIHBhdGgsIGZhbHNlKTtcbiAgICB9IGVsc2UgaWYgKGlzTnVtYmVyKHZhbHVlKSkge1xuICAgICAgcmV0dXJuIG9iamVjdFBhdGguc2V0KG9iaiwgcGF0aCwgMCk7XG4gICAgfSBlbHNlIGlmIChpc0FycmF5KHZhbHVlKSkge1xuICAgICAgdmFsdWUubGVuZ3RoID0gMDtcbiAgICB9IGVsc2UgaWYgKGlzT2JqZWN0KHZhbHVlKSkge1xuICAgICAgZm9yIChpIGluIHZhbHVlKSB7XG4gICAgICAgIGlmIChfaGFzT3duUHJvcGVydHkuY2FsbCh2YWx1ZSwgaSkpIHtcbiAgICAgICAgICBkZWxldGUgdmFsdWVbaV07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgcmV0dXJuIG9iamVjdFBhdGguc2V0KG9iaiwgcGF0aCwgbnVsbCk7XG4gICAgfVxuICB9O1xuXG4gIG9iamVjdFBhdGgucHVzaCA9IGZ1bmN0aW9uIChvYmosIHBhdGggLyosIHZhbHVlcyAqLyl7XG4gICAgdmFyIGFyciA9IG9iamVjdFBhdGguZ2V0KG9iaiwgcGF0aCk7XG4gICAgaWYgKCFpc0FycmF5KGFycikpIHtcbiAgICAgIGFyciA9IFtdO1xuICAgICAgb2JqZWN0UGF0aC5zZXQob2JqLCBwYXRoLCBhcnIpO1xuICAgIH1cblxuICAgIGFyci5wdXNoLmFwcGx5KGFyciwgQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzLCAyKSk7XG4gIH07XG5cbiAgb2JqZWN0UGF0aC5jb2FsZXNjZSA9IGZ1bmN0aW9uIChvYmosIHBhdGhzLCBkZWZhdWx0VmFsdWUpIHtcbiAgICB2YXIgdmFsdWU7XG5cbiAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gcGF0aHMubGVuZ3RoOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIGlmICgodmFsdWUgPSBvYmplY3RQYXRoLmdldChvYmosIHBhdGhzW2ldKSkgIT09IHZvaWQgMCkge1xuICAgICAgICByZXR1cm4gdmFsdWU7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIGRlZmF1bHRWYWx1ZTtcbiAgfTtcblxuICBvYmplY3RQYXRoLmdldCA9IGZ1bmN0aW9uIChvYmosIHBhdGgsIGRlZmF1bHRWYWx1ZSl7XG4gICAgaWYgKGlzTnVtYmVyKHBhdGgpKSB7XG4gICAgICBwYXRoID0gW3BhdGhdO1xuICAgIH1cbiAgICBpZiAoaXNFbXB0eShwYXRoKSkge1xuICAgICAgcmV0dXJuIG9iajtcbiAgICB9XG4gICAgaWYgKGlzRW1wdHkob2JqKSkge1xuICAgICAgcmV0dXJuIGRlZmF1bHRWYWx1ZTtcbiAgICB9XG4gICAgaWYgKGlzU3RyaW5nKHBhdGgpKSB7XG4gICAgICByZXR1cm4gb2JqZWN0UGF0aC5nZXQob2JqLCBwYXRoLnNwbGl0KCcuJyksIGRlZmF1bHRWYWx1ZSk7XG4gICAgfVxuXG4gICAgdmFyIGN1cnJlbnRQYXRoID0gZ2V0S2V5KHBhdGhbMF0pO1xuXG4gICAgaWYgKHBhdGgubGVuZ3RoID09PSAxKSB7XG4gICAgICBpZiAob2JqW2N1cnJlbnRQYXRoXSA9PT0gdm9pZCAwKSB7XG4gICAgICAgIHJldHVybiBkZWZhdWx0VmFsdWU7XG4gICAgICB9XG4gICAgICByZXR1cm4gb2JqW2N1cnJlbnRQYXRoXTtcbiAgICB9XG5cbiAgICByZXR1cm4gb2JqZWN0UGF0aC5nZXQob2JqW2N1cnJlbnRQYXRoXSwgcGF0aC5zbGljZSgxKSwgZGVmYXVsdFZhbHVlKTtcbiAgfTtcblxuICBvYmplY3RQYXRoLmRlbCA9IGZ1bmN0aW9uKG9iaiwgcGF0aCkge1xuICAgIHJldHVybiBkZWwob2JqLCBwYXRoKTtcbiAgfTtcblxuICByZXR1cm4gb2JqZWN0UGF0aDtcbn0pO1xuIiwiXG5cbi8vXG4vLyBHZW5lcmF0ZWQgb24gVHVlIERlYyAxNiAyMDE0IDEyOjEzOjQ3IEdNVCswMTAwIChDRVQpIGJ5IENoYXJsaWUgUm9iYmlucywgUGFvbG8gRnJhZ29tZW5pICYgdGhlIENvbnRyaWJ1dG9ycyAoVXNpbmcgQ29kZXN1cmdlb24pLlxuLy8gVmVyc2lvbiAxLjIuNlxuLy9cblxuKGZ1bmN0aW9uIChleHBvcnRzKSB7XG5cbi8qXG4gKiBicm93c2VyLmpzOiBCcm93c2VyIHNwZWNpZmljIGZ1bmN0aW9uYWxpdHkgZm9yIGRpcmVjdG9yLlxuICpcbiAqIChDKSAyMDExLCBDaGFybGllIFJvYmJpbnMsIFBhb2xvIEZyYWdvbWVuaSwgJiB0aGUgQ29udHJpYnV0b3JzLlxuICogTUlUIExJQ0VOU0VcbiAqXG4gKi9cblxudmFyIGRsb2MgPSBkb2N1bWVudC5sb2NhdGlvbjtcblxuZnVuY3Rpb24gZGxvY0hhc2hFbXB0eSgpIHtcbiAgLy8gTm9uLUlFIGJyb3dzZXJzIHJldHVybiAnJyB3aGVuIHRoZSBhZGRyZXNzIGJhciBzaG93cyAnIyc7IERpcmVjdG9yJ3MgbG9naWNcbiAgLy8gYXNzdW1lcyBib3RoIG1lYW4gZW1wdHkuXG4gIHJldHVybiBkbG9jLmhhc2ggPT09ICcnIHx8IGRsb2MuaGFzaCA9PT0gJyMnO1xufVxuXG52YXIgbGlzdGVuZXIgPSB7XG4gIG1vZGU6ICdtb2Rlcm4nLFxuICBoYXNoOiBkbG9jLmhhc2gsXG4gIGhpc3Rvcnk6IGZhbHNlLFxuXG4gIGNoZWNrOiBmdW5jdGlvbiAoKSB7XG4gICAgdmFyIGggPSBkbG9jLmhhc2g7XG4gICAgaWYgKGggIT0gdGhpcy5oYXNoKSB7XG4gICAgICB0aGlzLmhhc2ggPSBoO1xuICAgICAgdGhpcy5vbkhhc2hDaGFuZ2VkKCk7XG4gICAgfVxuICB9LFxuXG4gIGZpcmU6IGZ1bmN0aW9uICgpIHtcbiAgICBpZiAodGhpcy5tb2RlID09PSAnbW9kZXJuJykge1xuICAgICAgdGhpcy5oaXN0b3J5ID09PSB0cnVlID8gd2luZG93Lm9ucG9wc3RhdGUoKSA6IHdpbmRvdy5vbmhhc2hjaGFuZ2UoKTtcbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICB0aGlzLm9uSGFzaENoYW5nZWQoKTtcbiAgICB9XG4gIH0sXG5cbiAgaW5pdDogZnVuY3Rpb24gKGZuLCBoaXN0b3J5KSB7XG4gICAgdmFyIHNlbGYgPSB0aGlzO1xuICAgIHRoaXMuaGlzdG9yeSA9IGhpc3Rvcnk7XG5cbiAgICBpZiAoIVJvdXRlci5saXN0ZW5lcnMpIHtcbiAgICAgIFJvdXRlci5saXN0ZW5lcnMgPSBbXTtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBvbmNoYW5nZShvbkNoYW5nZUV2ZW50KSB7XG4gICAgICBmb3IgKHZhciBpID0gMCwgbCA9IFJvdXRlci5saXN0ZW5lcnMubGVuZ3RoOyBpIDwgbDsgaSsrKSB7XG4gICAgICAgIFJvdXRlci5saXN0ZW5lcnNbaV0ob25DaGFuZ2VFdmVudCk7XG4gICAgICB9XG4gICAgfVxuXG4gICAgLy9ub3RlIElFOCBpcyBiZWluZyBjb3VudGVkIGFzICdtb2Rlcm4nIGJlY2F1c2UgaXQgaGFzIHRoZSBoYXNoY2hhbmdlIGV2ZW50XG4gICAgaWYgKCdvbmhhc2hjaGFuZ2UnIGluIHdpbmRvdyAmJiAoZG9jdW1lbnQuZG9jdW1lbnRNb2RlID09PSB1bmRlZmluZWRcbiAgICAgIHx8IGRvY3VtZW50LmRvY3VtZW50TW9kZSA+IDcpKSB7XG4gICAgICAvLyBBdCBsZWFzdCBmb3Igbm93IEhUTUw1IGhpc3RvcnkgaXMgYXZhaWxhYmxlIGZvciAnbW9kZXJuJyBicm93c2VycyBvbmx5XG4gICAgICBpZiAodGhpcy5oaXN0b3J5ID09PSB0cnVlKSB7XG4gICAgICAgIC8vIFRoZXJlIGlzIGFuIG9sZCBidWcgaW4gQ2hyb21lIHRoYXQgY2F1c2VzIG9ucG9wc3RhdGUgdG8gZmlyZSBldmVuXG4gICAgICAgIC8vIHVwb24gaW5pdGlhbCBwYWdlIGxvYWQuIFNpbmNlIHRoZSBoYW5kbGVyIGlzIHJ1biBtYW51YWxseSBpbiBpbml0KCksXG4gICAgICAgIC8vIHRoaXMgd291bGQgY2F1c2UgQ2hyb21lIHRvIHJ1biBpdCB0d2lzZS4gQ3VycmVudGx5IHRoZSBvbmx5XG4gICAgICAgIC8vIHdvcmthcm91bmQgc2VlbXMgdG8gYmUgdG8gc2V0IHRoZSBoYW5kbGVyIGFmdGVyIHRoZSBpbml0aWFsIHBhZ2UgbG9hZFxuICAgICAgICAvLyBodHRwOi8vY29kZS5nb29nbGUuY29tL3AvY2hyb21pdW0vaXNzdWVzL2RldGFpbD9pZD02MzA0MFxuICAgICAgICBzZXRUaW1lb3V0KGZ1bmN0aW9uKCkge1xuICAgICAgICAgIHdpbmRvdy5vbnBvcHN0YXRlID0gb25jaGFuZ2U7XG4gICAgICAgIH0sIDUwMCk7XG4gICAgICB9XG4gICAgICBlbHNlIHtcbiAgICAgICAgd2luZG93Lm9uaGFzaGNoYW5nZSA9IG9uY2hhbmdlO1xuICAgICAgfVxuICAgICAgdGhpcy5tb2RlID0gJ21vZGVybic7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgLy9cbiAgICAgIC8vIElFIHN1cHBvcnQsIGJhc2VkIG9uIGEgY29uY2VwdCBieSBFcmlrIEFydmlkc29uIC4uLlxuICAgICAgLy9cbiAgICAgIHZhciBmcmFtZSA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ2lmcmFtZScpO1xuICAgICAgZnJhbWUuaWQgPSAnc3RhdGUtZnJhbWUnO1xuICAgICAgZnJhbWUuc3R5bGUuZGlzcGxheSA9ICdub25lJztcbiAgICAgIGRvY3VtZW50LmJvZHkuYXBwZW5kQ2hpbGQoZnJhbWUpO1xuICAgICAgdGhpcy53cml0ZUZyYW1lKCcnKTtcblxuICAgICAgaWYgKCdvbnByb3BlcnR5Y2hhbmdlJyBpbiBkb2N1bWVudCAmJiAnYXR0YWNoRXZlbnQnIGluIGRvY3VtZW50KSB7XG4gICAgICAgIGRvY3VtZW50LmF0dGFjaEV2ZW50KCdvbnByb3BlcnR5Y2hhbmdlJywgZnVuY3Rpb24gKCkge1xuICAgICAgICAgIGlmIChldmVudC5wcm9wZXJ0eU5hbWUgPT09ICdsb2NhdGlvbicpIHtcbiAgICAgICAgICAgIHNlbGYuY2hlY2soKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuICAgICAgfVxuXG4gICAgICB3aW5kb3cuc2V0SW50ZXJ2YWwoZnVuY3Rpb24gKCkgeyBzZWxmLmNoZWNrKCk7IH0sIDUwKTtcblxuICAgICAgdGhpcy5vbkhhc2hDaGFuZ2VkID0gb25jaGFuZ2U7XG4gICAgICB0aGlzLm1vZGUgPSAnbGVnYWN5JztcbiAgICB9XG5cbiAgICBSb3V0ZXIubGlzdGVuZXJzLnB1c2goZm4pO1xuXG4gICAgcmV0dXJuIHRoaXMubW9kZTtcbiAgfSxcblxuICBkZXN0cm95OiBmdW5jdGlvbiAoZm4pIHtcbiAgICBpZiAoIVJvdXRlciB8fCAhUm91dGVyLmxpc3RlbmVycykge1xuICAgICAgcmV0dXJuO1xuICAgIH1cblxuICAgIHZhciBsaXN0ZW5lcnMgPSBSb3V0ZXIubGlzdGVuZXJzO1xuXG4gICAgZm9yICh2YXIgaSA9IGxpc3RlbmVycy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgaWYgKGxpc3RlbmVyc1tpXSA9PT0gZm4pIHtcbiAgICAgICAgbGlzdGVuZXJzLnNwbGljZShpLCAxKTtcbiAgICAgIH1cbiAgICB9XG4gIH0sXG5cbiAgc2V0SGFzaDogZnVuY3Rpb24gKHMpIHtcbiAgICAvLyBNb3ppbGxhIGFsd2F5cyBhZGRzIGFuIGVudHJ5IHRvIHRoZSBoaXN0b3J5XG4gICAgaWYgKHRoaXMubW9kZSA9PT0gJ2xlZ2FjeScpIHtcbiAgICAgIHRoaXMud3JpdGVGcmFtZShzKTtcbiAgICB9XG5cbiAgICBpZiAodGhpcy5oaXN0b3J5ID09PSB0cnVlKSB7XG4gICAgICB3aW5kb3cuaGlzdG9yeS5wdXNoU3RhdGUoe30sIGRvY3VtZW50LnRpdGxlLCBzKTtcbiAgICAgIC8vIEZpcmUgYW4gb25wb3BzdGF0ZSBldmVudCBtYW51YWxseSBzaW5jZSBwdXNoaW5nIGRvZXMgbm90IG9idmlvdXNseVxuICAgICAgLy8gdHJpZ2dlciB0aGUgcG9wIGV2ZW50LlxuICAgICAgdGhpcy5maXJlKCk7XG4gICAgfSBlbHNlIHtcbiAgICAgIGRsb2MuaGFzaCA9IChzWzBdID09PSAnLycpID8gcyA6ICcvJyArIHM7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9LFxuXG4gIHdyaXRlRnJhbWU6IGZ1bmN0aW9uIChzKSB7XG4gICAgLy8gSUUgc3VwcG9ydC4uLlxuICAgIHZhciBmID0gZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ3N0YXRlLWZyYW1lJyk7XG4gICAgdmFyIGQgPSBmLmNvbnRlbnREb2N1bWVudCB8fCBmLmNvbnRlbnRXaW5kb3cuZG9jdW1lbnQ7XG4gICAgZC5vcGVuKCk7XG4gICAgZC53cml0ZShcIjxzY3JpcHQ+X2hhc2ggPSAnXCIgKyBzICsgXCInOyBvbmxvYWQgPSBwYXJlbnQubGlzdGVuZXIuc3luY0hhc2g7PHNjcmlwdD5cIik7XG4gICAgZC5jbG9zZSgpO1xuICB9LFxuXG4gIHN5bmNIYXNoOiBmdW5jdGlvbiAoKSB7XG4gICAgLy8gSUUgc3VwcG9ydC4uLlxuICAgIHZhciBzID0gdGhpcy5faGFzaDtcbiAgICBpZiAocyAhPSBkbG9jLmhhc2gpIHtcbiAgICAgIGRsb2MuaGFzaCA9IHM7XG4gICAgfVxuICAgIHJldHVybiB0aGlzO1xuICB9LFxuXG4gIG9uSGFzaENoYW5nZWQ6IGZ1bmN0aW9uICgpIHt9XG59O1xuXG52YXIgUm91dGVyID0gZXhwb3J0cy5Sb3V0ZXIgPSBmdW5jdGlvbiAocm91dGVzKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBSb3V0ZXIpKSByZXR1cm4gbmV3IFJvdXRlcihyb3V0ZXMpO1xuXG4gIHRoaXMucGFyYW1zICAgPSB7fTtcbiAgdGhpcy5yb3V0ZXMgICA9IHt9O1xuICB0aGlzLm1ldGhvZHMgID0gWydvbicsICdvbmNlJywgJ2FmdGVyJywgJ2JlZm9yZSddO1xuICB0aGlzLnNjb3BlICAgID0gW107XG4gIHRoaXMuX21ldGhvZHMgPSB7fTtcblxuICB0aGlzLl9pbnNlcnQgPSB0aGlzLmluc2VydDtcbiAgdGhpcy5pbnNlcnQgPSB0aGlzLmluc2VydEV4O1xuXG4gIHRoaXMuaGlzdG9yeVN1cHBvcnQgPSAod2luZG93Lmhpc3RvcnkgIT0gbnVsbCA/IHdpbmRvdy5oaXN0b3J5LnB1c2hTdGF0ZSA6IG51bGwpICE9IG51bGxcblxuICB0aGlzLmNvbmZpZ3VyZSgpO1xuICB0aGlzLm1vdW50KHJvdXRlcyB8fCB7fSk7XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLmluaXQgPSBmdW5jdGlvbiAocikge1xuICB2YXIgc2VsZiA9IHRoaXNcbiAgICAsIHJvdXRlVG87XG4gIHRoaXMuaGFuZGxlciA9IGZ1bmN0aW9uKG9uQ2hhbmdlRXZlbnQpIHtcbiAgICB2YXIgbmV3VVJMID0gb25DaGFuZ2VFdmVudCAmJiBvbkNoYW5nZUV2ZW50Lm5ld1VSTCB8fCB3aW5kb3cubG9jYXRpb24uaGFzaDtcbiAgICB2YXIgdXJsID0gc2VsZi5oaXN0b3J5ID09PSB0cnVlID8gc2VsZi5nZXRQYXRoKCkgOiBuZXdVUkwucmVwbGFjZSgvLiojLywgJycpO1xuICAgIHNlbGYuZGlzcGF0Y2goJ29uJywgdXJsLmNoYXJBdCgwKSA9PT0gJy8nID8gdXJsIDogJy8nICsgdXJsKTtcbiAgfTtcblxuICBsaXN0ZW5lci5pbml0KHRoaXMuaGFuZGxlciwgdGhpcy5oaXN0b3J5KTtcblxuICBpZiAodGhpcy5oaXN0b3J5ID09PSBmYWxzZSkge1xuICAgIGlmIChkbG9jSGFzaEVtcHR5KCkgJiYgcikge1xuICAgICAgZGxvYy5oYXNoID0gcjtcbiAgICB9IGVsc2UgaWYgKCFkbG9jSGFzaEVtcHR5KCkpIHtcbiAgICAgIHNlbGYuZGlzcGF0Y2goJ29uJywgJy8nICsgZGxvYy5oYXNoLnJlcGxhY2UoL14oI1xcL3wjfFxcLykvLCAnJykpO1xuICAgIH1cbiAgfVxuICBlbHNlIHtcbiAgICBpZiAodGhpcy5jb252ZXJ0X2hhc2hfaW5faW5pdCkge1xuICAgICAgLy8gVXNlIGhhc2ggYXMgcm91dGVcbiAgICAgIHJvdXRlVG8gPSBkbG9jSGFzaEVtcHR5KCkgJiYgciA/IHIgOiAhZGxvY0hhc2hFbXB0eSgpID8gZGxvYy5oYXNoLnJlcGxhY2UoL14jLywgJycpIDogbnVsbDtcbiAgICAgIGlmIChyb3V0ZVRvKSB7XG4gICAgICAgIHdpbmRvdy5oaXN0b3J5LnJlcGxhY2VTdGF0ZSh7fSwgZG9jdW1lbnQudGl0bGUsIHJvdXRlVG8pO1xuICAgICAgfVxuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgIC8vIFVzZSBjYW5vbmljYWwgdXJsXG4gICAgICByb3V0ZVRvID0gdGhpcy5nZXRQYXRoKCk7XG4gICAgfVxuXG4gICAgLy8gUm91dGVyIGhhcyBiZWVuIGluaXRpYWxpemVkLCBidXQgZHVlIHRvIHRoZSBjaHJvbWUgYnVnIGl0IHdpbGwgbm90XG4gICAgLy8geWV0IGFjdHVhbGx5IHJvdXRlIEhUTUw1IGhpc3Rvcnkgc3RhdGUgY2hhbmdlcy4gVGh1cywgZGVjaWRlIGlmIHNob3VsZCByb3V0ZS5cbiAgICBpZiAocm91dGVUbyB8fCB0aGlzLnJ1bl9pbl9pbml0ID09PSB0cnVlKSB7XG4gICAgICB0aGlzLmhhbmRsZXIoKTtcbiAgICB9XG4gIH1cblxuICByZXR1cm4gdGhpcztcbn07XG5cblJvdXRlci5wcm90b3R5cGUuZXhwbG9kZSA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIHYgPSB0aGlzLmhpc3RvcnkgPT09IHRydWUgPyB0aGlzLmdldFBhdGgoKSA6IGRsb2MuaGFzaDtcbiAgaWYgKHYuY2hhckF0KDEpID09PSAnLycpIHsgdj12LnNsaWNlKDEpIH1cbiAgcmV0dXJuIHYuc2xpY2UoMSwgdi5sZW5ndGgpLnNwbGl0KFwiL1wiKTtcbn07XG5cblJvdXRlci5wcm90b3R5cGUuc2V0Um91dGUgPSBmdW5jdGlvbiAoaSwgdiwgdmFsKSB7XG4gIHZhciB1cmwgPSB0aGlzLmV4cGxvZGUoKTtcblxuICBpZiAodHlwZW9mIGkgPT09ICdudW1iZXInICYmIHR5cGVvZiB2ID09PSAnc3RyaW5nJykge1xuICAgIHVybFtpXSA9IHY7XG4gIH1cbiAgZWxzZSBpZiAodHlwZW9mIHZhbCA9PT0gJ3N0cmluZycpIHtcbiAgICB1cmwuc3BsaWNlKGksIHYsIHMpO1xuICB9XG4gIGVsc2Uge1xuICAgIHVybCA9IFtpXTtcbiAgfVxuXG4gIGxpc3RlbmVyLnNldEhhc2godXJsLmpvaW4oJy8nKSk7XG4gIHJldHVybiB1cmw7XG59O1xuXG4vL1xuLy8gIyMjIGZ1bmN0aW9uIGluc2VydEV4KG1ldGhvZCwgcGF0aCwgcm91dGUsIHBhcmVudClcbi8vICMjIyMgQG1ldGhvZCB7c3RyaW5nfSBNZXRob2QgdG8gaW5zZXJ0IHRoZSBzcGVjaWZpYyBgcm91dGVgLlxuLy8gIyMjIyBAcGF0aCB7QXJyYXl9IFBhcnNlZCBwYXRoIHRvIGluc2VydCB0aGUgYHJvdXRlYCBhdC5cbi8vICMjIyMgQHJvdXRlIHtBcnJheXxmdW5jdGlvbn0gUm91dGUgaGFuZGxlcnMgdG8gaW5zZXJ0LlxuLy8gIyMjIyBAcGFyZW50IHtPYmplY3R9ICoqT3B0aW9uYWwqKiBQYXJlbnQgXCJyb3V0ZXNcIiB0byBpbnNlcnQgaW50by5cbi8vIGluc2VydCBhIGNhbGxiYWNrIHRoYXQgd2lsbCBvbmx5IG9jY3VyIG9uY2UgcGVyIHRoZSBtYXRjaGVkIHJvdXRlLlxuLy9cblJvdXRlci5wcm90b3R5cGUuaW5zZXJ0RXggPSBmdW5jdGlvbihtZXRob2QsIHBhdGgsIHJvdXRlLCBwYXJlbnQpIHtcbiAgaWYgKG1ldGhvZCA9PT0gXCJvbmNlXCIpIHtcbiAgICBtZXRob2QgPSBcIm9uXCI7XG4gICAgcm91dGUgPSBmdW5jdGlvbihyb3V0ZSkge1xuICAgICAgdmFyIG9uY2UgPSBmYWxzZTtcbiAgICAgIHJldHVybiBmdW5jdGlvbigpIHtcbiAgICAgICAgaWYgKG9uY2UpIHJldHVybjtcbiAgICAgICAgb25jZSA9IHRydWU7XG4gICAgICAgIHJldHVybiByb3V0ZS5hcHBseSh0aGlzLCBhcmd1bWVudHMpO1xuICAgICAgfTtcbiAgICB9KHJvdXRlKTtcbiAgfVxuICByZXR1cm4gdGhpcy5faW5zZXJ0KG1ldGhvZCwgcGF0aCwgcm91dGUsIHBhcmVudCk7XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLmdldFJvdXRlID0gZnVuY3Rpb24gKHYpIHtcbiAgdmFyIHJldCA9IHY7XG5cbiAgaWYgKHR5cGVvZiB2ID09PSBcIm51bWJlclwiKSB7XG4gICAgcmV0ID0gdGhpcy5leHBsb2RlKClbdl07XG4gIH1cbiAgZWxzZSBpZiAodHlwZW9mIHYgPT09IFwic3RyaW5nXCIpe1xuICAgIHZhciBoID0gdGhpcy5leHBsb2RlKCk7XG4gICAgcmV0ID0gaC5pbmRleE9mKHYpO1xuICB9XG4gIGVsc2Uge1xuICAgIHJldCA9IHRoaXMuZXhwbG9kZSgpO1xuICB9XG5cbiAgcmV0dXJuIHJldDtcbn07XG5cblJvdXRlci5wcm90b3R5cGUuZGVzdHJveSA9IGZ1bmN0aW9uICgpIHtcbiAgbGlzdGVuZXIuZGVzdHJveSh0aGlzLmhhbmRsZXIpO1xuICByZXR1cm4gdGhpcztcbn07XG5cblJvdXRlci5wcm90b3R5cGUuZ2V0UGF0aCA9IGZ1bmN0aW9uICgpIHtcbiAgdmFyIHBhdGggPSB3aW5kb3cubG9jYXRpb24ucGF0aG5hbWU7XG4gIGlmIChwYXRoLnN1YnN0cigwLCAxKSAhPT0gJy8nKSB7XG4gICAgcGF0aCA9ICcvJyArIHBhdGg7XG4gIH1cbiAgcmV0dXJuIHBhdGg7XG59O1xuZnVuY3Rpb24gX2V2ZXJ5KGFyciwgaXRlcmF0b3IpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcnIubGVuZ3RoOyBpICs9IDEpIHtcbiAgICBpZiAoaXRlcmF0b3IoYXJyW2ldLCBpLCBhcnIpID09PSBmYWxzZSkge1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfVxufVxuXG5mdW5jdGlvbiBfZmxhdHRlbihhcnIpIHtcbiAgdmFyIGZsYXQgPSBbXTtcbiAgZm9yICh2YXIgaSA9IDAsIG4gPSBhcnIubGVuZ3RoOyBpIDwgbjsgaSsrKSB7XG4gICAgZmxhdCA9IGZsYXQuY29uY2F0KGFycltpXSk7XG4gIH1cbiAgcmV0dXJuIGZsYXQ7XG59XG5cbmZ1bmN0aW9uIF9hc3luY0V2ZXJ5U2VyaWVzKGFyciwgaXRlcmF0b3IsIGNhbGxiYWNrKSB7XG4gIGlmICghYXJyLmxlbmd0aCkge1xuICAgIHJldHVybiBjYWxsYmFjaygpO1xuICB9XG4gIHZhciBjb21wbGV0ZWQgPSAwO1xuICAoZnVuY3Rpb24gaXRlcmF0ZSgpIHtcbiAgICBpdGVyYXRvcihhcnJbY29tcGxldGVkXSwgZnVuY3Rpb24oZXJyKSB7XG4gICAgICBpZiAoZXJyIHx8IGVyciA9PT0gZmFsc2UpIHtcbiAgICAgICAgY2FsbGJhY2soZXJyKTtcbiAgICAgICAgY2FsbGJhY2sgPSBmdW5jdGlvbigpIHt9O1xuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29tcGxldGVkICs9IDE7XG4gICAgICAgIGlmIChjb21wbGV0ZWQgPT09IGFyci5sZW5ndGgpIHtcbiAgICAgICAgICBjYWxsYmFjaygpO1xuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGl0ZXJhdGUoKTtcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pO1xuICB9KSgpO1xufVxuXG5mdW5jdGlvbiBwYXJhbWlmeVN0cmluZyhzdHIsIHBhcmFtcywgbW9kKSB7XG4gIG1vZCA9IHN0cjtcbiAgZm9yICh2YXIgcGFyYW0gaW4gcGFyYW1zKSB7XG4gICAgaWYgKHBhcmFtcy5oYXNPd25Qcm9wZXJ0eShwYXJhbSkpIHtcbiAgICAgIG1vZCA9IHBhcmFtc1twYXJhbV0oc3RyKTtcbiAgICAgIGlmIChtb2QgIT09IHN0cikge1xuICAgICAgICBicmVhaztcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIG1vZCA9PT0gc3RyID8gXCIoWy5fYS16QS1aMC05LSUoKV0rKVwiIDogbW9kO1xufVxuXG5mdW5jdGlvbiByZWdpZnlTdHJpbmcoc3RyLCBwYXJhbXMpIHtcbiAgdmFyIG1hdGNoZXMsIGxhc3QgPSAwLCBvdXQgPSBcIlwiO1xuICB3aGlsZSAobWF0Y2hlcyA9IHN0ci5zdWJzdHIobGFzdCkubWF0Y2goL1teXFx3XFxkXFwtICVAJl0qXFwqW15cXHdcXGRcXC0gJUAmXSovKSkge1xuICAgIGxhc3QgPSBtYXRjaGVzLmluZGV4ICsgbWF0Y2hlc1swXS5sZW5ndGg7XG4gICAgbWF0Y2hlc1swXSA9IG1hdGNoZXNbMF0ucmVwbGFjZSgvXlxcKi8sIFwiKFtfLigpIVxcXFwgJUAmYS16QS1aMC05LV0rKVwiKTtcbiAgICBvdXQgKz0gc3RyLnN1YnN0cigwLCBtYXRjaGVzLmluZGV4KSArIG1hdGNoZXNbMF07XG4gIH1cbiAgc3RyID0gb3V0ICs9IHN0ci5zdWJzdHIobGFzdCk7XG4gIHZhciBjYXB0dXJlcyA9IHN0ci5tYXRjaCgvOihbXlxcL10rKS9pZyksIGNhcHR1cmUsIGxlbmd0aDtcbiAgaWYgKGNhcHR1cmVzKSB7XG4gICAgbGVuZ3RoID0gY2FwdHVyZXMubGVuZ3RoO1xuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICAgIGNhcHR1cmUgPSBjYXB0dXJlc1tpXTtcbiAgICAgIGlmIChjYXB0dXJlLnNsaWNlKDAsIDIpID09PSBcIjo6XCIpIHtcbiAgICAgICAgc3RyID0gY2FwdHVyZS5zbGljZSgxKTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIHN0ciA9IHN0ci5yZXBsYWNlKGNhcHR1cmUsIHBhcmFtaWZ5U3RyaW5nKGNhcHR1cmUsIHBhcmFtcykpO1xuICAgICAgfVxuICAgIH1cbiAgfVxuICByZXR1cm4gc3RyO1xufVxuXG5mdW5jdGlvbiB0ZXJtaW5hdG9yKHJvdXRlcywgZGVsaW1pdGVyLCBzdGFydCwgc3RvcCkge1xuICB2YXIgbGFzdCA9IDAsIGxlZnQgPSAwLCByaWdodCA9IDAsIHN0YXJ0ID0gKHN0YXJ0IHx8IFwiKFwiKS50b1N0cmluZygpLCBzdG9wID0gKHN0b3AgfHwgXCIpXCIpLnRvU3RyaW5nKCksIGk7XG4gIGZvciAoaSA9IDA7IGkgPCByb3V0ZXMubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgY2h1bmsgPSByb3V0ZXNbaV07XG4gICAgaWYgKGNodW5rLmluZGV4T2Yoc3RhcnQsIGxhc3QpID4gY2h1bmsuaW5kZXhPZihzdG9wLCBsYXN0KSB8fCB+Y2h1bmsuaW5kZXhPZihzdGFydCwgbGFzdCkgJiYgIX5jaHVuay5pbmRleE9mKHN0b3AsIGxhc3QpIHx8ICF+Y2h1bmsuaW5kZXhPZihzdGFydCwgbGFzdCkgJiYgfmNodW5rLmluZGV4T2Yoc3RvcCwgbGFzdCkpIHtcbiAgICAgIGxlZnQgPSBjaHVuay5pbmRleE9mKHN0YXJ0LCBsYXN0KTtcbiAgICAgIHJpZ2h0ID0gY2h1bmsuaW5kZXhPZihzdG9wLCBsYXN0KTtcbiAgICAgIGlmICh+bGVmdCAmJiAhfnJpZ2h0IHx8ICF+bGVmdCAmJiB+cmlnaHQpIHtcbiAgICAgICAgdmFyIHRtcCA9IHJvdXRlcy5zbGljZSgwLCAoaSB8fCAxKSArIDEpLmpvaW4oZGVsaW1pdGVyKTtcbiAgICAgICAgcm91dGVzID0gWyB0bXAgXS5jb25jYXQocm91dGVzLnNsaWNlKChpIHx8IDEpICsgMSkpO1xuICAgICAgfVxuICAgICAgbGFzdCA9IChyaWdodCA+IGxlZnQgPyByaWdodCA6IGxlZnQpICsgMTtcbiAgICAgIGkgPSAwO1xuICAgIH0gZWxzZSB7XG4gICAgICBsYXN0ID0gMDtcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJvdXRlcztcbn1cblxudmFyIFFVRVJZX1NFUEFSQVRPUiA9IC9cXD8uKi87XG5cblJvdXRlci5wcm90b3R5cGUuY29uZmlndXJlID0gZnVuY3Rpb24ob3B0aW9ucykge1xuICBvcHRpb25zID0gb3B0aW9ucyB8fCB7fTtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCB0aGlzLm1ldGhvZHMubGVuZ3RoOyBpKyspIHtcbiAgICB0aGlzLl9tZXRob2RzW3RoaXMubWV0aG9kc1tpXV0gPSB0cnVlO1xuICB9XG4gIHRoaXMucmVjdXJzZSA9IG9wdGlvbnMucmVjdXJzZSB8fCB0aGlzLnJlY3Vyc2UgfHwgZmFsc2U7XG4gIHRoaXMuYXN5bmMgPSBvcHRpb25zLmFzeW5jIHx8IGZhbHNlO1xuICB0aGlzLmRlbGltaXRlciA9IG9wdGlvbnMuZGVsaW1pdGVyIHx8IFwiL1wiO1xuICB0aGlzLnN0cmljdCA9IHR5cGVvZiBvcHRpb25zLnN0cmljdCA9PT0gXCJ1bmRlZmluZWRcIiA/IHRydWUgOiBvcHRpb25zLnN0cmljdDtcbiAgdGhpcy5ub3Rmb3VuZCA9IG9wdGlvbnMubm90Zm91bmQ7XG4gIHRoaXMucmVzb3VyY2UgPSBvcHRpb25zLnJlc291cmNlO1xuICB0aGlzLmhpc3RvcnkgPSBvcHRpb25zLmh0bWw1aGlzdG9yeSAmJiB0aGlzLmhpc3RvcnlTdXBwb3J0IHx8IGZhbHNlO1xuICB0aGlzLnJ1bl9pbl9pbml0ID0gdGhpcy5oaXN0b3J5ID09PSB0cnVlICYmIG9wdGlvbnMucnVuX2hhbmRsZXJfaW5faW5pdCAhPT0gZmFsc2U7XG4gIHRoaXMuY29udmVydF9oYXNoX2luX2luaXQgPSB0aGlzLmhpc3RvcnkgPT09IHRydWUgJiYgb3B0aW9ucy5jb252ZXJ0X2hhc2hfaW5faW5pdCAhPT0gZmFsc2U7XG4gIHRoaXMuZXZlcnkgPSB7XG4gICAgYWZ0ZXI6IG9wdGlvbnMuYWZ0ZXIgfHwgbnVsbCxcbiAgICBiZWZvcmU6IG9wdGlvbnMuYmVmb3JlIHx8IG51bGwsXG4gICAgb246IG9wdGlvbnMub24gfHwgbnVsbFxuICB9O1xuICByZXR1cm4gdGhpcztcbn07XG5cblJvdXRlci5wcm90b3R5cGUucGFyYW0gPSBmdW5jdGlvbih0b2tlbiwgbWF0Y2hlcikge1xuICBpZiAodG9rZW5bMF0gIT09IFwiOlwiKSB7XG4gICAgdG9rZW4gPSBcIjpcIiArIHRva2VuO1xuICB9XG4gIHZhciBjb21waWxlZCA9IG5ldyBSZWdFeHAodG9rZW4sIFwiZ1wiKTtcbiAgdGhpcy5wYXJhbXNbdG9rZW5dID0gZnVuY3Rpb24oc3RyKSB7XG4gICAgcmV0dXJuIHN0ci5yZXBsYWNlKGNvbXBpbGVkLCBtYXRjaGVyLnNvdXJjZSB8fCBtYXRjaGVyKTtcbiAgfTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLm9uID0gUm91dGVyLnByb3RvdHlwZS5yb3V0ZSA9IGZ1bmN0aW9uKG1ldGhvZCwgcGF0aCwgcm91dGUpIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBpZiAoIXJvdXRlICYmIHR5cGVvZiBwYXRoID09IFwiZnVuY3Rpb25cIikge1xuICAgIHJvdXRlID0gcGF0aDtcbiAgICBwYXRoID0gbWV0aG9kO1xuICAgIG1ldGhvZCA9IFwib25cIjtcbiAgfVxuICBpZiAoQXJyYXkuaXNBcnJheShwYXRoKSkge1xuICAgIHJldHVybiBwYXRoLmZvckVhY2goZnVuY3Rpb24ocCkge1xuICAgICAgc2VsZi5vbihtZXRob2QsIHAsIHJvdXRlKTtcbiAgICB9KTtcbiAgfVxuICBpZiAocGF0aC5zb3VyY2UpIHtcbiAgICBwYXRoID0gcGF0aC5zb3VyY2UucmVwbGFjZSgvXFxcXFxcLy9pZywgXCIvXCIpO1xuICB9XG4gIGlmIChBcnJheS5pc0FycmF5KG1ldGhvZCkpIHtcbiAgICByZXR1cm4gbWV0aG9kLmZvckVhY2goZnVuY3Rpb24obSkge1xuICAgICAgc2VsZi5vbihtLnRvTG93ZXJDYXNlKCksIHBhdGgsIHJvdXRlKTtcbiAgICB9KTtcbiAgfVxuICBwYXRoID0gcGF0aC5zcGxpdChuZXcgUmVnRXhwKHRoaXMuZGVsaW1pdGVyKSk7XG4gIHBhdGggPSB0ZXJtaW5hdG9yKHBhdGgsIHRoaXMuZGVsaW1pdGVyKTtcbiAgdGhpcy5pbnNlcnQobWV0aG9kLCB0aGlzLnNjb3BlLmNvbmNhdChwYXRoKSwgcm91dGUpO1xufTtcblxuUm91dGVyLnByb3RvdHlwZS5wYXRoID0gZnVuY3Rpb24ocGF0aCwgcm91dGVzRm4pIHtcbiAgdmFyIHNlbGYgPSB0aGlzLCBsZW5ndGggPSB0aGlzLnNjb3BlLmxlbmd0aDtcbiAgaWYgKHBhdGguc291cmNlKSB7XG4gICAgcGF0aCA9IHBhdGguc291cmNlLnJlcGxhY2UoL1xcXFxcXC8vaWcsIFwiL1wiKTtcbiAgfVxuICBwYXRoID0gcGF0aC5zcGxpdChuZXcgUmVnRXhwKHRoaXMuZGVsaW1pdGVyKSk7XG4gIHBhdGggPSB0ZXJtaW5hdG9yKHBhdGgsIHRoaXMuZGVsaW1pdGVyKTtcbiAgdGhpcy5zY29wZSA9IHRoaXMuc2NvcGUuY29uY2F0KHBhdGgpO1xuICByb3V0ZXNGbi5jYWxsKHRoaXMsIHRoaXMpO1xuICB0aGlzLnNjb3BlLnNwbGljZShsZW5ndGgsIHBhdGgubGVuZ3RoKTtcbn07XG5cblJvdXRlci5wcm90b3R5cGUuZGlzcGF0Y2ggPSBmdW5jdGlvbihtZXRob2QsIHBhdGgsIGNhbGxiYWNrKSB7XG4gIHZhciBzZWxmID0gdGhpcywgZm5zID0gdGhpcy50cmF2ZXJzZShtZXRob2QsIHBhdGgucmVwbGFjZShRVUVSWV9TRVBBUkFUT1IsIFwiXCIpLCB0aGlzLnJvdXRlcywgXCJcIiksIGludm9rZWQgPSB0aGlzLl9pbnZva2VkLCBhZnRlcjtcbiAgdGhpcy5faW52b2tlZCA9IHRydWU7XG4gIGlmICghZm5zIHx8IGZucy5sZW5ndGggPT09IDApIHtcbiAgICB0aGlzLmxhc3QgPSBbXTtcbiAgICBpZiAodHlwZW9mIHRoaXMubm90Zm91bmQgPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgdGhpcy5pbnZva2UoWyB0aGlzLm5vdGZvdW5kIF0sIHtcbiAgICAgICAgbWV0aG9kOiBtZXRob2QsXG4gICAgICAgIHBhdGg6IHBhdGhcbiAgICAgIH0sIGNhbGxiYWNrKTtcbiAgICB9XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG4gIGlmICh0aGlzLnJlY3Vyc2UgPT09IFwiZm9yd2FyZFwiKSB7XG4gICAgZm5zID0gZm5zLnJldmVyc2UoKTtcbiAgfVxuICBmdW5jdGlvbiB1cGRhdGVBbmRJbnZva2UoKSB7XG4gICAgc2VsZi5sYXN0ID0gZm5zLmFmdGVyO1xuICAgIHNlbGYuaW52b2tlKHNlbGYucnVubGlzdChmbnMpLCBzZWxmLCBjYWxsYmFjayk7XG4gIH1cbiAgYWZ0ZXIgPSB0aGlzLmV2ZXJ5ICYmIHRoaXMuZXZlcnkuYWZ0ZXIgPyBbIHRoaXMuZXZlcnkuYWZ0ZXIgXS5jb25jYXQodGhpcy5sYXN0KSA6IFsgdGhpcy5sYXN0IF07XG4gIGlmIChhZnRlciAmJiBhZnRlci5sZW5ndGggPiAwICYmIGludm9rZWQpIHtcbiAgICBpZiAodGhpcy5hc3luYykge1xuICAgICAgdGhpcy5pbnZva2UoYWZ0ZXIsIHRoaXMsIHVwZGF0ZUFuZEludm9rZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHRoaXMuaW52b2tlKGFmdGVyLCB0aGlzKTtcbiAgICAgIHVwZGF0ZUFuZEludm9rZSgpO1xuICAgIH1cbiAgICByZXR1cm4gdHJ1ZTtcbiAgfVxuICB1cGRhdGVBbmRJbnZva2UoKTtcbiAgcmV0dXJuIHRydWU7XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLmludm9rZSA9IGZ1bmN0aW9uKGZucywgdGhpc0FyZywgY2FsbGJhY2spIHtcbiAgdmFyIHNlbGYgPSB0aGlzO1xuICB2YXIgYXBwbHk7XG4gIGlmICh0aGlzLmFzeW5jKSB7XG4gICAgYXBwbHkgPSBmdW5jdGlvbihmbiwgbmV4dCkge1xuICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZm4pKSB7XG4gICAgICAgIHJldHVybiBfYXN5bmNFdmVyeVNlcmllcyhmbiwgYXBwbHksIG5leHQpO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZm4gPT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIGZuLmFwcGx5KHRoaXNBcmcsIChmbnMuY2FwdHVyZXMgfHwgW10pLmNvbmNhdChuZXh0KSk7XG4gICAgICB9XG4gICAgfTtcbiAgICBfYXN5bmNFdmVyeVNlcmllcyhmbnMsIGFwcGx5LCBmdW5jdGlvbigpIHtcbiAgICAgIGlmIChjYWxsYmFjaykge1xuICAgICAgICBjYWxsYmFjay5hcHBseSh0aGlzQXJnLCBhcmd1bWVudHMpO1xuICAgICAgfVxuICAgIH0pO1xuICB9IGVsc2Uge1xuICAgIGFwcGx5ID0gZnVuY3Rpb24oZm4pIHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGZuKSkge1xuICAgICAgICByZXR1cm4gX2V2ZXJ5KGZuLCBhcHBseSk7XG4gICAgICB9IGVsc2UgaWYgKHR5cGVvZiBmbiA9PT0gXCJmdW5jdGlvblwiKSB7XG4gICAgICAgIHJldHVybiBmbi5hcHBseSh0aGlzQXJnLCBmbnMuY2FwdHVyZXMgfHwgW10pO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZm4gPT09IFwic3RyaW5nXCIgJiYgc2VsZi5yZXNvdXJjZSkge1xuICAgICAgICBzZWxmLnJlc291cmNlW2ZuXS5hcHBseSh0aGlzQXJnLCBmbnMuY2FwdHVyZXMgfHwgW10pO1xuICAgICAgfVxuICAgIH07XG4gICAgX2V2ZXJ5KGZucywgYXBwbHkpO1xuICB9XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLnRyYXZlcnNlID0gZnVuY3Rpb24obWV0aG9kLCBwYXRoLCByb3V0ZXMsIHJlZ2V4cCwgZmlsdGVyKSB7XG4gIHZhciBmbnMgPSBbXSwgY3VycmVudCwgZXhhY3QsIG1hdGNoLCBuZXh0LCB0aGF0O1xuICBmdW5jdGlvbiBmaWx0ZXJSb3V0ZXMocm91dGVzKSB7XG4gICAgaWYgKCFmaWx0ZXIpIHtcbiAgICAgIHJldHVybiByb3V0ZXM7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGRlZXBDb3B5KHNvdXJjZSkge1xuICAgICAgdmFyIHJlc3VsdCA9IFtdO1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBzb3VyY2UubGVuZ3RoOyBpKyspIHtcbiAgICAgICAgcmVzdWx0W2ldID0gQXJyYXkuaXNBcnJheShzb3VyY2VbaV0pID8gZGVlcENvcHkoc291cmNlW2ldKSA6IHNvdXJjZVtpXTtcbiAgICAgIH1cbiAgICAgIHJldHVybiByZXN1bHQ7XG4gICAgfVxuICAgIGZ1bmN0aW9uIGFwcGx5RmlsdGVyKGZucykge1xuICAgICAgZm9yICh2YXIgaSA9IGZucy5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgICBpZiAoQXJyYXkuaXNBcnJheShmbnNbaV0pKSB7XG4gICAgICAgICAgYXBwbHlGaWx0ZXIoZm5zW2ldKTtcbiAgICAgICAgICBpZiAoZm5zW2ldLmxlbmd0aCA9PT0gMCkge1xuICAgICAgICAgICAgZm5zLnNwbGljZShpLCAxKTtcbiAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgaWYgKCFmaWx0ZXIoZm5zW2ldKSkge1xuICAgICAgICAgICAgZm5zLnNwbGljZShpLCAxKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9XG4gICAgdmFyIG5ld1JvdXRlcyA9IGRlZXBDb3B5KHJvdXRlcyk7XG4gICAgbmV3Um91dGVzLm1hdGNoZWQgPSByb3V0ZXMubWF0Y2hlZDtcbiAgICBuZXdSb3V0ZXMuY2FwdHVyZXMgPSByb3V0ZXMuY2FwdHVyZXM7XG4gICAgbmV3Um91dGVzLmFmdGVyID0gcm91dGVzLmFmdGVyLmZpbHRlcihmaWx0ZXIpO1xuICAgIGFwcGx5RmlsdGVyKG5ld1JvdXRlcyk7XG4gICAgcmV0dXJuIG5ld1JvdXRlcztcbiAgfVxuICBpZiAocGF0aCA9PT0gdGhpcy5kZWxpbWl0ZXIgJiYgcm91dGVzW21ldGhvZF0pIHtcbiAgICBuZXh0ID0gWyBbIHJvdXRlcy5iZWZvcmUsIHJvdXRlc1ttZXRob2RdIF0uZmlsdGVyKEJvb2xlYW4pIF07XG4gICAgbmV4dC5hZnRlciA9IFsgcm91dGVzLmFmdGVyIF0uZmlsdGVyKEJvb2xlYW4pO1xuICAgIG5leHQubWF0Y2hlZCA9IHRydWU7XG4gICAgbmV4dC5jYXB0dXJlcyA9IFtdO1xuICAgIHJldHVybiBmaWx0ZXJSb3V0ZXMobmV4dCk7XG4gIH1cbiAgZm9yICh2YXIgciBpbiByb3V0ZXMpIHtcbiAgICBpZiAocm91dGVzLmhhc093blByb3BlcnR5KHIpICYmICghdGhpcy5fbWV0aG9kc1tyXSB8fCB0aGlzLl9tZXRob2RzW3JdICYmIHR5cGVvZiByb3V0ZXNbcl0gPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkocm91dGVzW3JdKSkpIHtcbiAgICAgIGN1cnJlbnQgPSBleGFjdCA9IHJlZ2V4cCArIHRoaXMuZGVsaW1pdGVyICsgcjtcbiAgICAgIGlmICghdGhpcy5zdHJpY3QpIHtcbiAgICAgICAgZXhhY3QgKz0gXCJbXCIgKyB0aGlzLmRlbGltaXRlciArIFwiXT9cIjtcbiAgICAgIH1cbiAgICAgIG1hdGNoID0gcGF0aC5tYXRjaChuZXcgUmVnRXhwKFwiXlwiICsgZXhhY3QpKTtcbiAgICAgIGlmICghbWF0Y2gpIHtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICBpZiAobWF0Y2hbMF0gJiYgbWF0Y2hbMF0gPT0gcGF0aCAmJiByb3V0ZXNbcl1bbWV0aG9kXSkge1xuICAgICAgICBuZXh0ID0gWyBbIHJvdXRlc1tyXS5iZWZvcmUsIHJvdXRlc1tyXVttZXRob2RdIF0uZmlsdGVyKEJvb2xlYW4pIF07XG4gICAgICAgIG5leHQuYWZ0ZXIgPSBbIHJvdXRlc1tyXS5hZnRlciBdLmZpbHRlcihCb29sZWFuKTtcbiAgICAgICAgbmV4dC5tYXRjaGVkID0gdHJ1ZTtcbiAgICAgICAgbmV4dC5jYXB0dXJlcyA9IG1hdGNoLnNsaWNlKDEpO1xuICAgICAgICBpZiAodGhpcy5yZWN1cnNlICYmIHJvdXRlcyA9PT0gdGhpcy5yb3V0ZXMpIHtcbiAgICAgICAgICBuZXh0LnB1c2goWyByb3V0ZXMuYmVmb3JlLCByb3V0ZXMub24gXS5maWx0ZXIoQm9vbGVhbikpO1xuICAgICAgICAgIG5leHQuYWZ0ZXIgPSBuZXh0LmFmdGVyLmNvbmNhdChbIHJvdXRlcy5hZnRlciBdLmZpbHRlcihCb29sZWFuKSk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZpbHRlclJvdXRlcyhuZXh0KTtcbiAgICAgIH1cbiAgICAgIG5leHQgPSB0aGlzLnRyYXZlcnNlKG1ldGhvZCwgcGF0aCwgcm91dGVzW3JdLCBjdXJyZW50KTtcbiAgICAgIGlmIChuZXh0Lm1hdGNoZWQpIHtcbiAgICAgICAgaWYgKG5leHQubGVuZ3RoID4gMCkge1xuICAgICAgICAgIGZucyA9IGZucy5jb25jYXQobmV4dCk7XG4gICAgICAgIH1cbiAgICAgICAgaWYgKHRoaXMucmVjdXJzZSkge1xuICAgICAgICAgIGZucy5wdXNoKFsgcm91dGVzW3JdLmJlZm9yZSwgcm91dGVzW3JdLm9uIF0uZmlsdGVyKEJvb2xlYW4pKTtcbiAgICAgICAgICBuZXh0LmFmdGVyID0gbmV4dC5hZnRlci5jb25jYXQoWyByb3V0ZXNbcl0uYWZ0ZXIgXS5maWx0ZXIoQm9vbGVhbikpO1xuICAgICAgICAgIGlmIChyb3V0ZXMgPT09IHRoaXMucm91dGVzKSB7XG4gICAgICAgICAgICBmbnMucHVzaChbIHJvdXRlc1tcImJlZm9yZVwiXSwgcm91dGVzW1wib25cIl0gXS5maWx0ZXIoQm9vbGVhbikpO1xuICAgICAgICAgICAgbmV4dC5hZnRlciA9IG5leHQuYWZ0ZXIuY29uY2F0KFsgcm91dGVzW1wiYWZ0ZXJcIl0gXS5maWx0ZXIoQm9vbGVhbikpO1xuICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBmbnMubWF0Y2hlZCA9IHRydWU7XG4gICAgICAgIGZucy5jYXB0dXJlcyA9IG5leHQuY2FwdHVyZXM7XG4gICAgICAgIGZucy5hZnRlciA9IG5leHQuYWZ0ZXI7XG4gICAgICAgIHJldHVybiBmaWx0ZXJSb3V0ZXMoZm5zKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIGZhbHNlO1xufTtcblxuUm91dGVyLnByb3RvdHlwZS5pbnNlcnQgPSBmdW5jdGlvbihtZXRob2QsIHBhdGgsIHJvdXRlLCBwYXJlbnQpIHtcbiAgdmFyIG1ldGhvZFR5cGUsIHBhcmVudFR5cGUsIGlzQXJyYXksIG5lc3RlZCwgcGFydDtcbiAgcGF0aCA9IHBhdGguZmlsdGVyKGZ1bmN0aW9uKHApIHtcbiAgICByZXR1cm4gcCAmJiBwLmxlbmd0aCA+IDA7XG4gIH0pO1xuICBwYXJlbnQgPSBwYXJlbnQgfHwgdGhpcy5yb3V0ZXM7XG4gIHBhcnQgPSBwYXRoLnNoaWZ0KCk7XG4gIGlmICgvXFw6fFxcKi8udGVzdChwYXJ0KSAmJiAhL1xcXFxkfFxcXFx3Ly50ZXN0KHBhcnQpKSB7XG4gICAgcGFydCA9IHJlZ2lmeVN0cmluZyhwYXJ0LCB0aGlzLnBhcmFtcyk7XG4gIH1cbiAgaWYgKHBhdGgubGVuZ3RoID4gMCkge1xuICAgIHBhcmVudFtwYXJ0XSA9IHBhcmVudFtwYXJ0XSB8fCB7fTtcbiAgICByZXR1cm4gdGhpcy5pbnNlcnQobWV0aG9kLCBwYXRoLCByb3V0ZSwgcGFyZW50W3BhcnRdKTtcbiAgfVxuICBpZiAoIXBhcnQgJiYgIXBhdGgubGVuZ3RoICYmIHBhcmVudCA9PT0gdGhpcy5yb3V0ZXMpIHtcbiAgICBtZXRob2RUeXBlID0gdHlwZW9mIHBhcmVudFttZXRob2RdO1xuICAgIHN3aXRjaCAobWV0aG9kVHlwZSkge1xuICAgICBjYXNlIFwiZnVuY3Rpb25cIjpcbiAgICAgIHBhcmVudFttZXRob2RdID0gWyBwYXJlbnRbbWV0aG9kXSwgcm91dGUgXTtcbiAgICAgIHJldHVybjtcbiAgICAgY2FzZSBcIm9iamVjdFwiOlxuICAgICAgcGFyZW50W21ldGhvZF0ucHVzaChyb3V0ZSk7XG4gICAgICByZXR1cm47XG4gICAgIGNhc2UgXCJ1bmRlZmluZWRcIjpcbiAgICAgIHBhcmVudFttZXRob2RdID0gcm91dGU7XG4gICAgICByZXR1cm47XG4gICAgfVxuICAgIHJldHVybjtcbiAgfVxuICBwYXJlbnRUeXBlID0gdHlwZW9mIHBhcmVudFtwYXJ0XTtcbiAgaXNBcnJheSA9IEFycmF5LmlzQXJyYXkocGFyZW50W3BhcnRdKTtcbiAgaWYgKHBhcmVudFtwYXJ0XSAmJiAhaXNBcnJheSAmJiBwYXJlbnRUeXBlID09IFwib2JqZWN0XCIpIHtcbiAgICBtZXRob2RUeXBlID0gdHlwZW9mIHBhcmVudFtwYXJ0XVttZXRob2RdO1xuICAgIHN3aXRjaCAobWV0aG9kVHlwZSkge1xuICAgICBjYXNlIFwiZnVuY3Rpb25cIjpcbiAgICAgIHBhcmVudFtwYXJ0XVttZXRob2RdID0gWyBwYXJlbnRbcGFydF1bbWV0aG9kXSwgcm91dGUgXTtcbiAgICAgIHJldHVybjtcbiAgICAgY2FzZSBcIm9iamVjdFwiOlxuICAgICAgcGFyZW50W3BhcnRdW21ldGhvZF0ucHVzaChyb3V0ZSk7XG4gICAgICByZXR1cm47XG4gICAgIGNhc2UgXCJ1bmRlZmluZWRcIjpcbiAgICAgIHBhcmVudFtwYXJ0XVttZXRob2RdID0gcm91dGU7XG4gICAgICByZXR1cm47XG4gICAgfVxuICB9IGVsc2UgaWYgKHBhcmVudFR5cGUgPT0gXCJ1bmRlZmluZWRcIikge1xuICAgIG5lc3RlZCA9IHt9O1xuICAgIG5lc3RlZFttZXRob2RdID0gcm91dGU7XG4gICAgcGFyZW50W3BhcnRdID0gbmVzdGVkO1xuICAgIHJldHVybjtcbiAgfVxuICB0aHJvdyBuZXcgRXJyb3IoXCJJbnZhbGlkIHJvdXRlIGNvbnRleHQ6IFwiICsgcGFyZW50VHlwZSk7XG59O1xuXG5cblxuUm91dGVyLnByb3RvdHlwZS5leHRlbmQgPSBmdW5jdGlvbihtZXRob2RzKSB7XG4gIHZhciBzZWxmID0gdGhpcywgbGVuID0gbWV0aG9kcy5sZW5ndGgsIGk7XG4gIGZ1bmN0aW9uIGV4dGVuZChtZXRob2QpIHtcbiAgICBzZWxmLl9tZXRob2RzW21ldGhvZF0gPSB0cnVlO1xuICAgIHNlbGZbbWV0aG9kXSA9IGZ1bmN0aW9uKCkge1xuICAgICAgdmFyIGV4dHJhID0gYXJndW1lbnRzLmxlbmd0aCA9PT0gMSA/IFsgbWV0aG9kLCBcIlwiIF0gOiBbIG1ldGhvZCBdO1xuICAgICAgc2VsZi5vbi5hcHBseShzZWxmLCBleHRyYS5jb25jYXQoQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKSkpO1xuICAgIH07XG4gIH1cbiAgZm9yIChpID0gMDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgZXh0ZW5kKG1ldGhvZHNbaV0pO1xuICB9XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLnJ1bmxpc3QgPSBmdW5jdGlvbihmbnMpIHtcbiAgdmFyIHJ1bmxpc3QgPSB0aGlzLmV2ZXJ5ICYmIHRoaXMuZXZlcnkuYmVmb3JlID8gWyB0aGlzLmV2ZXJ5LmJlZm9yZSBdLmNvbmNhdChfZmxhdHRlbihmbnMpKSA6IF9mbGF0dGVuKGZucyk7XG4gIGlmICh0aGlzLmV2ZXJ5ICYmIHRoaXMuZXZlcnkub24pIHtcbiAgICBydW5saXN0LnB1c2godGhpcy5ldmVyeS5vbik7XG4gIH1cbiAgcnVubGlzdC5jYXB0dXJlcyA9IGZucy5jYXB0dXJlcztcbiAgcnVubGlzdC5zb3VyY2UgPSBmbnMuc291cmNlO1xuICByZXR1cm4gcnVubGlzdDtcbn07XG5cblJvdXRlci5wcm90b3R5cGUubW91bnQgPSBmdW5jdGlvbihyb3V0ZXMsIHBhdGgpIHtcbiAgaWYgKCFyb3V0ZXMgfHwgdHlwZW9mIHJvdXRlcyAhPT0gXCJvYmplY3RcIiB8fCBBcnJheS5pc0FycmF5KHJvdXRlcykpIHtcbiAgICByZXR1cm47XG4gIH1cbiAgdmFyIHNlbGYgPSB0aGlzO1xuICBwYXRoID0gcGF0aCB8fCBbXTtcbiAgaWYgKCFBcnJheS5pc0FycmF5KHBhdGgpKSB7XG4gICAgcGF0aCA9IHBhdGguc3BsaXQoc2VsZi5kZWxpbWl0ZXIpO1xuICB9XG4gIGZ1bmN0aW9uIGluc2VydE9yTW91bnQocm91dGUsIGxvY2FsKSB7XG4gICAgdmFyIHJlbmFtZSA9IHJvdXRlLCBwYXJ0cyA9IHJvdXRlLnNwbGl0KHNlbGYuZGVsaW1pdGVyKSwgcm91dGVUeXBlID0gdHlwZW9mIHJvdXRlc1tyb3V0ZV0sIGlzUm91dGUgPSBwYXJ0c1swXSA9PT0gXCJcIiB8fCAhc2VsZi5fbWV0aG9kc1twYXJ0c1swXV0sIGV2ZW50ID0gaXNSb3V0ZSA/IFwib25cIiA6IHJlbmFtZTtcbiAgICBpZiAoaXNSb3V0ZSkge1xuICAgICAgcmVuYW1lID0gcmVuYW1lLnNsaWNlKChyZW5hbWUubWF0Y2gobmV3IFJlZ0V4cChcIl5cIiArIHNlbGYuZGVsaW1pdGVyKSkgfHwgWyBcIlwiIF0pWzBdLmxlbmd0aCk7XG4gICAgICBwYXJ0cy5zaGlmdCgpO1xuICAgIH1cbiAgICBpZiAoaXNSb3V0ZSAmJiByb3V0ZVR5cGUgPT09IFwib2JqZWN0XCIgJiYgIUFycmF5LmlzQXJyYXkocm91dGVzW3JvdXRlXSkpIHtcbiAgICAgIGxvY2FsID0gbG9jYWwuY29uY2F0KHBhcnRzKTtcbiAgICAgIHNlbGYubW91bnQocm91dGVzW3JvdXRlXSwgbG9jYWwpO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICBpZiAoaXNSb3V0ZSkge1xuICAgICAgbG9jYWwgPSBsb2NhbC5jb25jYXQocmVuYW1lLnNwbGl0KHNlbGYuZGVsaW1pdGVyKSk7XG4gICAgICBsb2NhbCA9IHRlcm1pbmF0b3IobG9jYWwsIHNlbGYuZGVsaW1pdGVyKTtcbiAgICB9XG4gICAgc2VsZi5pbnNlcnQoZXZlbnQsIGxvY2FsLCByb3V0ZXNbcm91dGVdKTtcbiAgfVxuICBmb3IgKHZhciByb3V0ZSBpbiByb3V0ZXMpIHtcbiAgICBpZiAocm91dGVzLmhhc093blByb3BlcnR5KHJvdXRlKSkge1xuICAgICAgaW5zZXJ0T3JNb3VudChyb3V0ZSwgcGF0aC5zbGljZSgwKSk7XG4gICAgfVxuICB9XG59O1xuXG5cblxufSh0eXBlb2YgZXhwb3J0cyA9PT0gXCJvYmplY3RcIiA/IGV4cG9ydHMgOiB3aW5kb3cpKTsiLCIvKipcbiAqIENvcHlyaWdodCAoYykgMjAxNC0yMDE1LCBGYWNlYm9vaywgSW5jLlxuICogQWxsIHJpZ2h0cyByZXNlcnZlZC5cbiAqXG4gKiBUaGlzIHNvdXJjZSBjb2RlIGlzIGxpY2Vuc2VkIHVuZGVyIHRoZSBCU0Qtc3R5bGUgbGljZW5zZSBmb3VuZCBpbiB0aGVcbiAqIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBkaXJlY3Rvcnkgb2YgdGhpcyBzb3VyY2UgdHJlZS4gQW4gYWRkaXRpb25hbCBncmFudFxuICogb2YgcGF0ZW50IHJpZ2h0cyBjYW4gYmUgZm91bmQgaW4gdGhlIFBBVEVOVFMgZmlsZSBpbiB0aGUgc2FtZSBkaXJlY3RvcnkuXG4gKi9cblxubW9kdWxlLmV4cG9ydHMuRGlzcGF0Y2hlciA9IHJlcXVpcmUoJy4vbGliL0Rpc3BhdGNoZXInKTtcbiIsIi8qKlxuICogQ29weXJpZ2h0IChjKSAyMDE0LTIwMTUsIEZhY2Vib29rLCBJbmMuXG4gKiBBbGwgcmlnaHRzIHJlc2VydmVkLlxuICpcbiAqIFRoaXMgc291cmNlIGNvZGUgaXMgbGljZW5zZWQgdW5kZXIgdGhlIEJTRC1zdHlsZSBsaWNlbnNlIGZvdW5kIGluIHRoZVxuICogTElDRU5TRSBmaWxlIGluIHRoZSByb290IGRpcmVjdG9yeSBvZiB0aGlzIHNvdXJjZSB0cmVlLiBBbiBhZGRpdGlvbmFsIGdyYW50XG4gKiBvZiBwYXRlbnQgcmlnaHRzIGNhbiBiZSBmb3VuZCBpbiB0aGUgUEFURU5UUyBmaWxlIGluIHRoZSBzYW1lIGRpcmVjdG9yeS5cbiAqXG4gKiBAcHJvdmlkZXNNb2R1bGUgRGlzcGF0Y2hlclxuICogXG4gKiBAcHJldmVudE11bmdlXG4gKi9cblxuJ3VzZSBzdHJpY3QnO1xuXG5leHBvcnRzLl9fZXNNb2R1bGUgPSB0cnVlO1xuXG5mdW5jdGlvbiBfY2xhc3NDYWxsQ2hlY2soaW5zdGFuY2UsIENvbnN0cnVjdG9yKSB7IGlmICghKGluc3RhbmNlIGluc3RhbmNlb2YgQ29uc3RydWN0b3IpKSB7IHRocm93IG5ldyBUeXBlRXJyb3IoJ0Nhbm5vdCBjYWxsIGEgY2xhc3MgYXMgYSBmdW5jdGlvbicpOyB9IH1cblxudmFyIGludmFyaWFudCA9IHJlcXVpcmUoJ2ZianMvbGliL2ludmFyaWFudCcpO1xuXG52YXIgX3ByZWZpeCA9ICdJRF8nO1xuXG4vKipcbiAqIERpc3BhdGNoZXIgaXMgdXNlZCB0byBicm9hZGNhc3QgcGF5bG9hZHMgdG8gcmVnaXN0ZXJlZCBjYWxsYmFja3MuIFRoaXMgaXNcbiAqIGRpZmZlcmVudCBmcm9tIGdlbmVyaWMgcHViLXN1YiBzeXN0ZW1zIGluIHR3byB3YXlzOlxuICpcbiAqICAgMSkgQ2FsbGJhY2tzIGFyZSBub3Qgc3Vic2NyaWJlZCB0byBwYXJ0aWN1bGFyIGV2ZW50cy4gRXZlcnkgcGF5bG9hZCBpc1xuICogICAgICBkaXNwYXRjaGVkIHRvIGV2ZXJ5IHJlZ2lzdGVyZWQgY2FsbGJhY2suXG4gKiAgIDIpIENhbGxiYWNrcyBjYW4gYmUgZGVmZXJyZWQgaW4gd2hvbGUgb3IgcGFydCB1bnRpbCBvdGhlciBjYWxsYmFja3MgaGF2ZVxuICogICAgICBiZWVuIGV4ZWN1dGVkLlxuICpcbiAqIEZvciBleGFtcGxlLCBjb25zaWRlciB0aGlzIGh5cG90aGV0aWNhbCBmbGlnaHQgZGVzdGluYXRpb24gZm9ybSwgd2hpY2hcbiAqIHNlbGVjdHMgYSBkZWZhdWx0IGNpdHkgd2hlbiBhIGNvdW50cnkgaXMgc2VsZWN0ZWQ6XG4gKlxuICogICB2YXIgZmxpZ2h0RGlzcGF0Y2hlciA9IG5ldyBEaXNwYXRjaGVyKCk7XG4gKlxuICogICAvLyBLZWVwcyB0cmFjayBvZiB3aGljaCBjb3VudHJ5IGlzIHNlbGVjdGVkXG4gKiAgIHZhciBDb3VudHJ5U3RvcmUgPSB7Y291bnRyeTogbnVsbH07XG4gKlxuICogICAvLyBLZWVwcyB0cmFjayBvZiB3aGljaCBjaXR5IGlzIHNlbGVjdGVkXG4gKiAgIHZhciBDaXR5U3RvcmUgPSB7Y2l0eTogbnVsbH07XG4gKlxuICogICAvLyBLZWVwcyB0cmFjayBvZiB0aGUgYmFzZSBmbGlnaHQgcHJpY2Ugb2YgdGhlIHNlbGVjdGVkIGNpdHlcbiAqICAgdmFyIEZsaWdodFByaWNlU3RvcmUgPSB7cHJpY2U6IG51bGx9XG4gKlxuICogV2hlbiBhIHVzZXIgY2hhbmdlcyB0aGUgc2VsZWN0ZWQgY2l0eSwgd2UgZGlzcGF0Y2ggdGhlIHBheWxvYWQ6XG4gKlxuICogICBmbGlnaHREaXNwYXRjaGVyLmRpc3BhdGNoKHtcbiAqICAgICBhY3Rpb25UeXBlOiAnY2l0eS11cGRhdGUnLFxuICogICAgIHNlbGVjdGVkQ2l0eTogJ3BhcmlzJ1xuICogICB9KTtcbiAqXG4gKiBUaGlzIHBheWxvYWQgaXMgZGlnZXN0ZWQgYnkgYENpdHlTdG9yZWA6XG4gKlxuICogICBmbGlnaHREaXNwYXRjaGVyLnJlZ2lzdGVyKGZ1bmN0aW9uKHBheWxvYWQpIHtcbiAqICAgICBpZiAocGF5bG9hZC5hY3Rpb25UeXBlID09PSAnY2l0eS11cGRhdGUnKSB7XG4gKiAgICAgICBDaXR5U3RvcmUuY2l0eSA9IHBheWxvYWQuc2VsZWN0ZWRDaXR5O1xuICogICAgIH1cbiAqICAgfSk7XG4gKlxuICogV2hlbiB0aGUgdXNlciBzZWxlY3RzIGEgY291bnRyeSwgd2UgZGlzcGF0Y2ggdGhlIHBheWxvYWQ6XG4gKlxuICogICBmbGlnaHREaXNwYXRjaGVyLmRpc3BhdGNoKHtcbiAqICAgICBhY3Rpb25UeXBlOiAnY291bnRyeS11cGRhdGUnLFxuICogICAgIHNlbGVjdGVkQ291bnRyeTogJ2F1c3RyYWxpYSdcbiAqICAgfSk7XG4gKlxuICogVGhpcyBwYXlsb2FkIGlzIGRpZ2VzdGVkIGJ5IGJvdGggc3RvcmVzOlxuICpcbiAqICAgQ291bnRyeVN0b3JlLmRpc3BhdGNoVG9rZW4gPSBmbGlnaHREaXNwYXRjaGVyLnJlZ2lzdGVyKGZ1bmN0aW9uKHBheWxvYWQpIHtcbiAqICAgICBpZiAocGF5bG9hZC5hY3Rpb25UeXBlID09PSAnY291bnRyeS11cGRhdGUnKSB7XG4gKiAgICAgICBDb3VudHJ5U3RvcmUuY291bnRyeSA9IHBheWxvYWQuc2VsZWN0ZWRDb3VudHJ5O1xuICogICAgIH1cbiAqICAgfSk7XG4gKlxuICogV2hlbiB0aGUgY2FsbGJhY2sgdG8gdXBkYXRlIGBDb3VudHJ5U3RvcmVgIGlzIHJlZ2lzdGVyZWQsIHdlIHNhdmUgYSByZWZlcmVuY2VcbiAqIHRvIHRoZSByZXR1cm5lZCB0b2tlbi4gVXNpbmcgdGhpcyB0b2tlbiB3aXRoIGB3YWl0Rm9yKClgLCB3ZSBjYW4gZ3VhcmFudGVlXG4gKiB0aGF0IGBDb3VudHJ5U3RvcmVgIGlzIHVwZGF0ZWQgYmVmb3JlIHRoZSBjYWxsYmFjayB0aGF0IHVwZGF0ZXMgYENpdHlTdG9yZWBcbiAqIG5lZWRzIHRvIHF1ZXJ5IGl0cyBkYXRhLlxuICpcbiAqICAgQ2l0eVN0b3JlLmRpc3BhdGNoVG9rZW4gPSBmbGlnaHREaXNwYXRjaGVyLnJlZ2lzdGVyKGZ1bmN0aW9uKHBheWxvYWQpIHtcbiAqICAgICBpZiAocGF5bG9hZC5hY3Rpb25UeXBlID09PSAnY291bnRyeS11cGRhdGUnKSB7XG4gKiAgICAgICAvLyBgQ291bnRyeVN0b3JlLmNvdW50cnlgIG1heSBub3QgYmUgdXBkYXRlZC5cbiAqICAgICAgIGZsaWdodERpc3BhdGNoZXIud2FpdEZvcihbQ291bnRyeVN0b3JlLmRpc3BhdGNoVG9rZW5dKTtcbiAqICAgICAgIC8vIGBDb3VudHJ5U3RvcmUuY291bnRyeWAgaXMgbm93IGd1YXJhbnRlZWQgdG8gYmUgdXBkYXRlZC5cbiAqXG4gKiAgICAgICAvLyBTZWxlY3QgdGhlIGRlZmF1bHQgY2l0eSBmb3IgdGhlIG5ldyBjb3VudHJ5XG4gKiAgICAgICBDaXR5U3RvcmUuY2l0eSA9IGdldERlZmF1bHRDaXR5Rm9yQ291bnRyeShDb3VudHJ5U3RvcmUuY291bnRyeSk7XG4gKiAgICAgfVxuICogICB9KTtcbiAqXG4gKiBUaGUgdXNhZ2Ugb2YgYHdhaXRGb3IoKWAgY2FuIGJlIGNoYWluZWQsIGZvciBleGFtcGxlOlxuICpcbiAqICAgRmxpZ2h0UHJpY2VTdG9yZS5kaXNwYXRjaFRva2VuID1cbiAqICAgICBmbGlnaHREaXNwYXRjaGVyLnJlZ2lzdGVyKGZ1bmN0aW9uKHBheWxvYWQpIHtcbiAqICAgICAgIHN3aXRjaCAocGF5bG9hZC5hY3Rpb25UeXBlKSB7XG4gKiAgICAgICAgIGNhc2UgJ2NvdW50cnktdXBkYXRlJzpcbiAqICAgICAgICAgY2FzZSAnY2l0eS11cGRhdGUnOlxuICogICAgICAgICAgIGZsaWdodERpc3BhdGNoZXIud2FpdEZvcihbQ2l0eVN0b3JlLmRpc3BhdGNoVG9rZW5dKTtcbiAqICAgICAgICAgICBGbGlnaHRQcmljZVN0b3JlLnByaWNlID1cbiAqICAgICAgICAgICAgIGdldEZsaWdodFByaWNlU3RvcmUoQ291bnRyeVN0b3JlLmNvdW50cnksIENpdHlTdG9yZS5jaXR5KTtcbiAqICAgICAgICAgICBicmVhaztcbiAqICAgICB9XG4gKiAgIH0pO1xuICpcbiAqIFRoZSBgY291bnRyeS11cGRhdGVgIHBheWxvYWQgd2lsbCBiZSBndWFyYW50ZWVkIHRvIGludm9rZSB0aGUgc3RvcmVzJ1xuICogcmVnaXN0ZXJlZCBjYWxsYmFja3MgaW4gb3JkZXI6IGBDb3VudHJ5U3RvcmVgLCBgQ2l0eVN0b3JlYCwgdGhlblxuICogYEZsaWdodFByaWNlU3RvcmVgLlxuICovXG5cbnZhciBEaXNwYXRjaGVyID0gKGZ1bmN0aW9uICgpIHtcbiAgZnVuY3Rpb24gRGlzcGF0Y2hlcigpIHtcbiAgICBfY2xhc3NDYWxsQ2hlY2sodGhpcywgRGlzcGF0Y2hlcik7XG5cbiAgICB0aGlzLl9jYWxsYmFja3MgPSB7fTtcbiAgICB0aGlzLl9pc0Rpc3BhdGNoaW5nID0gZmFsc2U7XG4gICAgdGhpcy5faXNIYW5kbGVkID0ge307XG4gICAgdGhpcy5faXNQZW5kaW5nID0ge307XG4gICAgdGhpcy5fbGFzdElEID0gMTtcbiAgfVxuXG4gIC8qKlxuICAgKiBSZWdpc3RlcnMgYSBjYWxsYmFjayB0byBiZSBpbnZva2VkIHdpdGggZXZlcnkgZGlzcGF0Y2hlZCBwYXlsb2FkLiBSZXR1cm5zXG4gICAqIGEgdG9rZW4gdGhhdCBjYW4gYmUgdXNlZCB3aXRoIGB3YWl0Rm9yKClgLlxuICAgKi9cblxuICBEaXNwYXRjaGVyLnByb3RvdHlwZS5yZWdpc3RlciA9IGZ1bmN0aW9uIHJlZ2lzdGVyKGNhbGxiYWNrKSB7XG4gICAgdmFyIGlkID0gX3ByZWZpeCArIHRoaXMuX2xhc3RJRCsrO1xuICAgIHRoaXMuX2NhbGxiYWNrc1tpZF0gPSBjYWxsYmFjaztcbiAgICByZXR1cm4gaWQ7XG4gIH07XG5cbiAgLyoqXG4gICAqIFJlbW92ZXMgYSBjYWxsYmFjayBiYXNlZCBvbiBpdHMgdG9rZW4uXG4gICAqL1xuXG4gIERpc3BhdGNoZXIucHJvdG90eXBlLnVucmVnaXN0ZXIgPSBmdW5jdGlvbiB1bnJlZ2lzdGVyKGlkKSB7XG4gICAgIXRoaXMuX2NhbGxiYWNrc1tpZF0gPyBwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nID8gaW52YXJpYW50KGZhbHNlLCAnRGlzcGF0Y2hlci51bnJlZ2lzdGVyKC4uLik6IGAlc2AgZG9lcyBub3QgbWFwIHRvIGEgcmVnaXN0ZXJlZCBjYWxsYmFjay4nLCBpZCkgOiBpbnZhcmlhbnQoZmFsc2UpIDogdW5kZWZpbmVkO1xuICAgIGRlbGV0ZSB0aGlzLl9jYWxsYmFja3NbaWRdO1xuICB9O1xuXG4gIC8qKlxuICAgKiBXYWl0cyBmb3IgdGhlIGNhbGxiYWNrcyBzcGVjaWZpZWQgdG8gYmUgaW52b2tlZCBiZWZvcmUgY29udGludWluZyBleGVjdXRpb25cbiAgICogb2YgdGhlIGN1cnJlbnQgY2FsbGJhY2suIFRoaXMgbWV0aG9kIHNob3VsZCBvbmx5IGJlIHVzZWQgYnkgYSBjYWxsYmFjayBpblxuICAgKiByZXNwb25zZSB0byBhIGRpc3BhdGNoZWQgcGF5bG9hZC5cbiAgICovXG5cbiAgRGlzcGF0Y2hlci5wcm90b3R5cGUud2FpdEZvciA9IGZ1bmN0aW9uIHdhaXRGb3IoaWRzKSB7XG4gICAgIXRoaXMuX2lzRGlzcGF0Y2hpbmcgPyBwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nID8gaW52YXJpYW50KGZhbHNlLCAnRGlzcGF0Y2hlci53YWl0Rm9yKC4uLik6IE11c3QgYmUgaW52b2tlZCB3aGlsZSBkaXNwYXRjaGluZy4nKSA6IGludmFyaWFudChmYWxzZSkgOiB1bmRlZmluZWQ7XG4gICAgZm9yICh2YXIgaWkgPSAwOyBpaSA8IGlkcy5sZW5ndGg7IGlpKyspIHtcbiAgICAgIHZhciBpZCA9IGlkc1tpaV07XG4gICAgICBpZiAodGhpcy5faXNQZW5kaW5nW2lkXSkge1xuICAgICAgICAhdGhpcy5faXNIYW5kbGVkW2lkXSA/IHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSAncHJvZHVjdGlvbicgPyBpbnZhcmlhbnQoZmFsc2UsICdEaXNwYXRjaGVyLndhaXRGb3IoLi4uKTogQ2lyY3VsYXIgZGVwZW5kZW5jeSBkZXRlY3RlZCB3aGlsZSAnICsgJ3dhaXRpbmcgZm9yIGAlc2AuJywgaWQpIDogaW52YXJpYW50KGZhbHNlKSA6IHVuZGVmaW5lZDtcbiAgICAgICAgY29udGludWU7XG4gICAgICB9XG4gICAgICAhdGhpcy5fY2FsbGJhY2tzW2lkXSA/IHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSAncHJvZHVjdGlvbicgPyBpbnZhcmlhbnQoZmFsc2UsICdEaXNwYXRjaGVyLndhaXRGb3IoLi4uKTogYCVzYCBkb2VzIG5vdCBtYXAgdG8gYSByZWdpc3RlcmVkIGNhbGxiYWNrLicsIGlkKSA6IGludmFyaWFudChmYWxzZSkgOiB1bmRlZmluZWQ7XG4gICAgICB0aGlzLl9pbnZva2VDYWxsYmFjayhpZCk7XG4gICAgfVxuICB9O1xuXG4gIC8qKlxuICAgKiBEaXNwYXRjaGVzIGEgcGF5bG9hZCB0byBhbGwgcmVnaXN0ZXJlZCBjYWxsYmFja3MuXG4gICAqL1xuXG4gIERpc3BhdGNoZXIucHJvdG90eXBlLmRpc3BhdGNoID0gZnVuY3Rpb24gZGlzcGF0Y2gocGF5bG9hZCkge1xuICAgICEhdGhpcy5faXNEaXNwYXRjaGluZyA/IHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSAncHJvZHVjdGlvbicgPyBpbnZhcmlhbnQoZmFsc2UsICdEaXNwYXRjaC5kaXNwYXRjaCguLi4pOiBDYW5ub3QgZGlzcGF0Y2ggaW4gdGhlIG1pZGRsZSBvZiBhIGRpc3BhdGNoLicpIDogaW52YXJpYW50KGZhbHNlKSA6IHVuZGVmaW5lZDtcbiAgICB0aGlzLl9zdGFydERpc3BhdGNoaW5nKHBheWxvYWQpO1xuICAgIHRyeSB7XG4gICAgICBmb3IgKHZhciBpZCBpbiB0aGlzLl9jYWxsYmFja3MpIHtcbiAgICAgICAgaWYgKHRoaXMuX2lzUGVuZGluZ1tpZF0pIHtcbiAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgfVxuICAgICAgICB0aGlzLl9pbnZva2VDYWxsYmFjayhpZCk7XG4gICAgICB9XG4gICAgfSBmaW5hbGx5IHtcbiAgICAgIHRoaXMuX3N0b3BEaXNwYXRjaGluZygpO1xuICAgIH1cbiAgfTtcblxuICAvKipcbiAgICogSXMgdGhpcyBEaXNwYXRjaGVyIGN1cnJlbnRseSBkaXNwYXRjaGluZy5cbiAgICovXG5cbiAgRGlzcGF0Y2hlci5wcm90b3R5cGUuaXNEaXNwYXRjaGluZyA9IGZ1bmN0aW9uIGlzRGlzcGF0Y2hpbmcoKSB7XG4gICAgcmV0dXJuIHRoaXMuX2lzRGlzcGF0Y2hpbmc7XG4gIH07XG5cbiAgLyoqXG4gICAqIENhbGwgdGhlIGNhbGxiYWNrIHN0b3JlZCB3aXRoIHRoZSBnaXZlbiBpZC4gQWxzbyBkbyBzb21lIGludGVybmFsXG4gICAqIGJvb2trZWVwaW5nLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG5cbiAgRGlzcGF0Y2hlci5wcm90b3R5cGUuX2ludm9rZUNhbGxiYWNrID0gZnVuY3Rpb24gX2ludm9rZUNhbGxiYWNrKGlkKSB7XG4gICAgdGhpcy5faXNQZW5kaW5nW2lkXSA9IHRydWU7XG4gICAgdGhpcy5fY2FsbGJhY2tzW2lkXSh0aGlzLl9wZW5kaW5nUGF5bG9hZCk7XG4gICAgdGhpcy5faXNIYW5kbGVkW2lkXSA9IHRydWU7XG4gIH07XG5cbiAgLyoqXG4gICAqIFNldCB1cCBib29ra2VlcGluZyBuZWVkZWQgd2hlbiBkaXNwYXRjaGluZy5cbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuXG4gIERpc3BhdGNoZXIucHJvdG90eXBlLl9zdGFydERpc3BhdGNoaW5nID0gZnVuY3Rpb24gX3N0YXJ0RGlzcGF0Y2hpbmcocGF5bG9hZCkge1xuICAgIGZvciAodmFyIGlkIGluIHRoaXMuX2NhbGxiYWNrcykge1xuICAgICAgdGhpcy5faXNQZW5kaW5nW2lkXSA9IGZhbHNlO1xuICAgICAgdGhpcy5faXNIYW5kbGVkW2lkXSA9IGZhbHNlO1xuICAgIH1cbiAgICB0aGlzLl9wZW5kaW5nUGF5bG9hZCA9IHBheWxvYWQ7XG4gICAgdGhpcy5faXNEaXNwYXRjaGluZyA9IHRydWU7XG4gIH07XG5cbiAgLyoqXG4gICAqIENsZWFyIGJvb2trZWVwaW5nIHVzZWQgZm9yIGRpc3BhdGNoaW5nLlxuICAgKlxuICAgKiBAaW50ZXJuYWxcbiAgICovXG5cbiAgRGlzcGF0Y2hlci5wcm90b3R5cGUuX3N0b3BEaXNwYXRjaGluZyA9IGZ1bmN0aW9uIF9zdG9wRGlzcGF0Y2hpbmcoKSB7XG4gICAgZGVsZXRlIHRoaXMuX3BlbmRpbmdQYXlsb2FkO1xuICAgIHRoaXMuX2lzRGlzcGF0Y2hpbmcgPSBmYWxzZTtcbiAgfTtcblxuICByZXR1cm4gRGlzcGF0Y2hlcjtcbn0pKCk7XG5cbm1vZHVsZS5leHBvcnRzID0gRGlzcGF0Y2hlcjsiLCIvKipcbiAqIENvcHlyaWdodCAyMDEzLTIwMTUsIEZhY2Vib29rLCBJbmMuXG4gKiBBbGwgcmlnaHRzIHJlc2VydmVkLlxuICpcbiAqIFRoaXMgc291cmNlIGNvZGUgaXMgbGljZW5zZWQgdW5kZXIgdGhlIEJTRC1zdHlsZSBsaWNlbnNlIGZvdW5kIGluIHRoZVxuICogTElDRU5TRSBmaWxlIGluIHRoZSByb290IGRpcmVjdG9yeSBvZiB0aGlzIHNvdXJjZSB0cmVlLiBBbiBhZGRpdGlvbmFsIGdyYW50XG4gKiBvZiBwYXRlbnQgcmlnaHRzIGNhbiBiZSBmb3VuZCBpbiB0aGUgUEFURU5UUyBmaWxlIGluIHRoZSBzYW1lIGRpcmVjdG9yeS5cbiAqXG4gKiBAcHJvdmlkZXNNb2R1bGUgaW52YXJpYW50XG4gKi9cblxuXCJ1c2Ugc3RyaWN0XCI7XG5cbi8qKlxuICogVXNlIGludmFyaWFudCgpIHRvIGFzc2VydCBzdGF0ZSB3aGljaCB5b3VyIHByb2dyYW0gYXNzdW1lcyB0byBiZSB0cnVlLlxuICpcbiAqIFByb3ZpZGUgc3ByaW50Zi1zdHlsZSBmb3JtYXQgKG9ubHkgJXMgaXMgc3VwcG9ydGVkKSBhbmQgYXJndW1lbnRzXG4gKiB0byBwcm92aWRlIGluZm9ybWF0aW9uIGFib3V0IHdoYXQgYnJva2UgYW5kIHdoYXQgeW91IHdlcmVcbiAqIGV4cGVjdGluZy5cbiAqXG4gKiBUaGUgaW52YXJpYW50IG1lc3NhZ2Ugd2lsbCBiZSBzdHJpcHBlZCBpbiBwcm9kdWN0aW9uLCBidXQgdGhlIGludmFyaWFudFxuICogd2lsbCByZW1haW4gdG8gZW5zdXJlIGxvZ2ljIGRvZXMgbm90IGRpZmZlciBpbiBwcm9kdWN0aW9uLlxuICovXG5cbnZhciBpbnZhcmlhbnQgPSBmdW5jdGlvbiAoY29uZGl0aW9uLCBmb3JtYXQsIGEsIGIsIGMsIGQsIGUsIGYpIHtcbiAgaWYgKHByb2Nlc3MuZW52Lk5PREVfRU5WICE9PSAncHJvZHVjdGlvbicpIHtcbiAgICBpZiAoZm9ybWF0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIHRocm93IG5ldyBFcnJvcignaW52YXJpYW50IHJlcXVpcmVzIGFuIGVycm9yIG1lc3NhZ2UgYXJndW1lbnQnKTtcbiAgICB9XG4gIH1cblxuICBpZiAoIWNvbmRpdGlvbikge1xuICAgIHZhciBlcnJvcjtcbiAgICBpZiAoZm9ybWF0ID09PSB1bmRlZmluZWQpIHtcbiAgICAgIGVycm9yID0gbmV3IEVycm9yKCdNaW5pZmllZCBleGNlcHRpb24gb2NjdXJyZWQ7IHVzZSB0aGUgbm9uLW1pbmlmaWVkIGRldiBlbnZpcm9ubWVudCAnICsgJ2ZvciB0aGUgZnVsbCBlcnJvciBtZXNzYWdlIGFuZCBhZGRpdGlvbmFsIGhlbHBmdWwgd2FybmluZ3MuJyk7XG4gICAgfSBlbHNlIHtcbiAgICAgIHZhciBhcmdzID0gW2EsIGIsIGMsIGQsIGUsIGZdO1xuICAgICAgdmFyIGFyZ0luZGV4ID0gMDtcbiAgICAgIGVycm9yID0gbmV3IEVycm9yKCdJbnZhcmlhbnQgVmlvbGF0aW9uOiAnICsgZm9ybWF0LnJlcGxhY2UoLyVzL2csIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgcmV0dXJuIGFyZ3NbYXJnSW5kZXgrK107XG4gICAgICB9KSk7XG4gICAgfVxuXG4gICAgZXJyb3IuZnJhbWVzVG9Qb3AgPSAxOyAvLyB3ZSBkb24ndCBjYXJlIGFib3V0IGludmFyaWFudCdzIG93biBmcmFtZVxuICAgIHRocm93IGVycm9yO1xuICB9XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IGludmFyaWFudDsiLCIvKiFcbiAqIENvcHlyaWdodCAoYykgMjAxNSBDaHJpcyBPJ0hhcmEgPGNvaGFyYTg3QGdtYWlsLmNvbT5cbiAqXG4gKiBQZXJtaXNzaW9uIGlzIGhlcmVieSBncmFudGVkLCBmcmVlIG9mIGNoYXJnZSwgdG8gYW55IHBlcnNvbiBvYnRhaW5pbmdcbiAqIGEgY29weSBvZiB0aGlzIHNvZnR3YXJlIGFuZCBhc3NvY2lhdGVkIGRvY3VtZW50YXRpb24gZmlsZXMgKHRoZVxuICogXCJTb2Z0d2FyZVwiKSwgdG8gZGVhbCBpbiB0aGUgU29mdHdhcmUgd2l0aG91dCByZXN0cmljdGlvbiwgaW5jbHVkaW5nXG4gKiB3aXRob3V0IGxpbWl0YXRpb24gdGhlIHJpZ2h0cyB0byB1c2UsIGNvcHksIG1vZGlmeSwgbWVyZ2UsIHB1Ymxpc2gsXG4gKiBkaXN0cmlidXRlLCBzdWJsaWNlbnNlLCBhbmQvb3Igc2VsbCBjb3BpZXMgb2YgdGhlIFNvZnR3YXJlLCBhbmQgdG9cbiAqIHBlcm1pdCBwZXJzb25zIHRvIHdob20gdGhlIFNvZnR3YXJlIGlzIGZ1cm5pc2hlZCB0byBkbyBzbywgc3ViamVjdCB0b1xuICogdGhlIGZvbGxvd2luZyBjb25kaXRpb25zOlxuICpcbiAqIFRoZSBhYm92ZSBjb3B5cmlnaHQgbm90aWNlIGFuZCB0aGlzIHBlcm1pc3Npb24gbm90aWNlIHNoYWxsIGJlXG4gKiBpbmNsdWRlZCBpbiBhbGwgY29waWVzIG9yIHN1YnN0YW50aWFsIHBvcnRpb25zIG9mIHRoZSBTb2Z0d2FyZS5cbiAqXG4gKiBUSEUgU09GVFdBUkUgSVMgUFJPVklERUQgXCJBUyBJU1wiLCBXSVRIT1VUIFdBUlJBTlRZIE9GIEFOWSBLSU5ELFxuICogRVhQUkVTUyBPUiBJTVBMSUVELCBJTkNMVURJTkcgQlVUIE5PVCBMSU1JVEVEIFRPIFRIRSBXQVJSQU5USUVTIE9GXG4gKiBNRVJDSEFOVEFCSUxJVFksIEZJVE5FU1MgRk9SIEEgUEFSVElDVUxBUiBQVVJQT1NFIEFORFxuICogTk9OSU5GUklOR0VNRU5ULiBJTiBOTyBFVkVOVCBTSEFMTCBUSEUgQVVUSE9SUyBPUiBDT1BZUklHSFQgSE9MREVSUyBCRVxuICogTElBQkxFIEZPUiBBTlkgQ0xBSU0sIERBTUFHRVMgT1IgT1RIRVIgTElBQklMSVRZLCBXSEVUSEVSIElOIEFOIEFDVElPTlxuICogT0YgQ09OVFJBQ1QsIFRPUlQgT1IgT1RIRVJXSVNFLCBBUklTSU5HIEZST00sIE9VVCBPRiBPUiBJTiBDT05ORUNUSU9OXG4gKiBXSVRIIFRIRSBTT0ZUV0FSRSBPUiBUSEUgVVNFIE9SIE9USEVSIERFQUxJTkdTIElOIFRIRSBTT0ZUV0FSRS5cbiAqL1xuXG4oZnVuY3Rpb24gKG5hbWUsIGRlZmluaXRpb24pIHtcbiAgICBpZiAodHlwZW9mIGV4cG9ydHMgIT09ICd1bmRlZmluZWQnICYmIHR5cGVvZiBtb2R1bGUgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICAgIG1vZHVsZS5leHBvcnRzID0gZGVmaW5pdGlvbigpO1xuICAgIH0gZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiB0eXBlb2YgZGVmaW5lLmFtZCA9PT0gJ29iamVjdCcpIHtcbiAgICAgICAgZGVmaW5lKGRlZmluaXRpb24pO1xuICAgIH0gZWxzZSB7XG4gICAgICAgIHRoaXNbbmFtZV0gPSBkZWZpbml0aW9uKCk7XG4gICAgfVxufSkoJ3ZhbGlkYXRvcicsIGZ1bmN0aW9uICh2YWxpZGF0b3IpIHtcblxuICAgICd1c2Ugc3RyaWN0JztcblxuICAgIHZhbGlkYXRvciA9IHsgdmVyc2lvbjogJzQuMS4wJyB9O1xuXG4gICAgdmFyIGVtYWlsVXNlclBhcnQgPSAvXlthLXpcXGQhI1xcJCUmJ1xcKlxcK1xcLVxcLz1cXD9cXF5fYHtcXHx9fl0rJC9pO1xuICAgIHZhciBxdW90ZWRFbWFpbFVzZXIgPSAvXihbXFxzXFx4MDEtXFx4MDhcXHgwYlxceDBjXFx4MGUtXFx4MWZcXHg3ZlxceDIxXFx4MjMtXFx4NWJcXHg1ZC1cXHg3ZV18KFxcXFxbXFx4MDEtXFx4MDlcXHgwYlxceDBjXFx4MGQtXFx4N2ZdKSkqJC9pO1xuXG4gICAgdmFyIGVtYWlsVXNlclV0ZjhQYXJ0ID0gL15bYS16XFxkISNcXCQlJidcXCpcXCtcXC1cXC89XFw/XFxeX2B7XFx8fX5cXHUwMEEwLVxcdUQ3RkZcXHVGOTAwLVxcdUZEQ0ZcXHVGREYwLVxcdUZGRUZdKyQvaTtcbiAgICB2YXIgcXVvdGVkRW1haWxVc2VyVXRmOCA9IC9eKFtcXHNcXHgwMS1cXHgwOFxceDBiXFx4MGNcXHgwZS1cXHgxZlxceDdmXFx4MjFcXHgyMy1cXHg1YlxceDVkLVxceDdlXFx1MDBBMC1cXHVEN0ZGXFx1RjkwMC1cXHVGRENGXFx1RkRGMC1cXHVGRkVGXXwoXFxcXFtcXHgwMS1cXHgwOVxceDBiXFx4MGNcXHgwZC1cXHg3ZlxcdTAwQTAtXFx1RDdGRlxcdUY5MDAtXFx1RkRDRlxcdUZERjAtXFx1RkZFRl0pKSokL2k7XG5cbiAgICB2YXIgZGlzcGxheU5hbWUgPSAvXlthLXpcXGQhI1xcJCUmJ1xcKlxcK1xcLVxcLz1cXD9cXF5fYHtcXHx9flxcLlxcdTAwQTAtXFx1RDdGRlxcdUY5MDAtXFx1RkRDRlxcdUZERjAtXFx1RkZFRl0rW2EtelxcZCEjXFwkJSYnXFwqXFwrXFwtXFwvPVxcP1xcXl9ge1xcfH1+XFwuXFx1MDBBMC1cXHVEN0ZGXFx1RjkwMC1cXHVGRENGXFx1RkRGMC1cXHVGRkVGXFxzXSo8KC4rKT4kL2k7XG5cbiAgICB2YXIgY3JlZGl0Q2FyZCA9IC9eKD86NFswLTldezEyfSg/OlswLTldezN9KT98NVsxLTVdWzAtOV17MTR9fDYoPzowMTF8NVswLTldWzAtOV0pWzAtOV17MTJ9fDNbNDddWzAtOV17MTN9fDMoPzowWzAtNV18WzY4XVswLTldKVswLTldezExfXwoPzoyMTMxfDE4MDB8MzVcXGR7M30pXFxkezExfSkkLztcblxuICAgIHZhciBpc2luID0gL15bQS1aXXsyfVswLTlBLVpdezl9WzAtOV0kLztcblxuICAgIHZhciBpc2JuMTBNYXliZSA9IC9eKD86WzAtOV17OX1YfFswLTldezEwfSkkL1xuICAgICAgLCBpc2JuMTNNYXliZSA9IC9eKD86WzAtOV17MTN9KSQvO1xuXG4gICAgdmFyIGlwdjRNYXliZSA9IC9eKFxcZCspXFwuKFxcZCspXFwuKFxcZCspXFwuKFxcZCspJC9cbiAgICAgICwgaXB2NkJsb2NrID0gL15bMC05QS1GXXsxLDR9JC9pO1xuXG4gICAgdmFyIHV1aWQgPSB7XG4gICAgICAgICczJzogL15bMC05QS1GXXs4fS1bMC05QS1GXXs0fS0zWzAtOUEtRl17M30tWzAtOUEtRl17NH0tWzAtOUEtRl17MTJ9JC9pXG4gICAgICAsICc0JzogL15bMC05QS1GXXs4fS1bMC05QS1GXXs0fS00WzAtOUEtRl17M30tWzg5QUJdWzAtOUEtRl17M30tWzAtOUEtRl17MTJ9JC9pXG4gICAgICAsICc1JzogL15bMC05QS1GXXs4fS1bMC05QS1GXXs0fS01WzAtOUEtRl17M30tWzg5QUJdWzAtOUEtRl17M30tWzAtOUEtRl17MTJ9JC9pXG4gICAgICAsIGFsbDogL15bMC05QS1GXXs4fS1bMC05QS1GXXs0fS1bMC05QS1GXXs0fS1bMC05QS1GXXs0fS1bMC05QS1GXXsxMn0kL2lcbiAgICB9O1xuXG4gICAgdmFyIGFscGhhID0gL15bQS1aXSskL2lcbiAgICAgICwgYWxwaGFudW1lcmljID0gL15bMC05QS1aXSskL2lcbiAgICAgICwgbnVtZXJpYyA9IC9eWy0rXT9bMC05XSskL1xuICAgICAgLCBpbnQgPSAvXig/OlstK10/KD86MHxbMS05XVswLTldKikpJC9cbiAgICAgICwgZmxvYXQgPSAvXig/OlstK10/KD86WzAtOV0rKSk/KD86XFwuWzAtOV0qKT8oPzpbZUVdW1xcK1xcLV0/KD86WzAtOV0rKSk/JC9cbiAgICAgICwgaGV4YWRlY2ltYWwgPSAvXlswLTlBLUZdKyQvaVxuICAgICAgLCBkZWNpbWFsID0gL15bLStdPyhbMC05XSt8XFwuWzAtOV0rfFswLTldK1xcLlswLTldKykkL1xuICAgICAgLCBoZXhjb2xvciA9IC9eIz8oWzAtOUEtRl17M318WzAtOUEtRl17Nn0pJC9pO1xuXG4gICAgdmFyIGFzY2lpID0gL15bXFx4MDAtXFx4N0ZdKyQvXG4gICAgICAsIG11bHRpYnl0ZSA9IC9bXlxceDAwLVxceDdGXS9cbiAgICAgICwgZnVsbFdpZHRoID0gL1teXFx1MDAyMC1cXHUwMDdFXFx1RkY2MS1cXHVGRjlGXFx1RkZBMC1cXHVGRkRDXFx1RkZFOC1cXHVGRkVFMC05YS16QS1aXS9cbiAgICAgICwgaGFsZldpZHRoID0gL1tcXHUwMDIwLVxcdTAwN0VcXHVGRjYxLVxcdUZGOUZcXHVGRkEwLVxcdUZGRENcXHVGRkU4LVxcdUZGRUUwLTlhLXpBLVpdLztcblxuICAgIHZhciBzdXJyb2dhdGVQYWlyID0gL1tcXHVEODAwLVxcdURCRkZdW1xcdURDMDAtXFx1REZGRl0vO1xuXG4gICAgdmFyIGJhc2U2NCA9IC9eKD86W0EtWjAtOStcXC9dezR9KSooPzpbQS1aMC05K1xcL117Mn09PXxbQS1aMC05K1xcL117M309fFtBLVowLTkrXFwvXXs0fSkkL2k7XG5cbiAgICB2YXIgcGhvbmVzID0ge1xuICAgICAgJ3poLUNOJzogL14oXFwrPzA/ODZcXC0/KT8xWzM0NTc4OV1cXGR7OX0kLyxcbiAgICAgICd6aC1UVyc6IC9eKFxcKz84ODZcXC0/fDApPzlcXGR7OH0kLyxcbiAgICAgICdlbi1aQSc6IC9eKFxcKz8yN3wwKVxcZHs5fSQvLFxuICAgICAgJ2VuLUFVJzogL14oXFwrPzYxfDApNFxcZHs4fSQvLFxuICAgICAgJ2VuLUhLJzogL14oXFwrPzg1MlxcLT8pP1s1NjldXFxkezN9XFwtP1xcZHs0fSQvLFxuICAgICAgJ2ZyLUZSJzogL14oXFwrPzMzfDApWzY3XVxcZHs4fSQvLFxuICAgICAgJ3B0LVBUJzogL14oXFwrMzUxKT85WzEyMzZdXFxkezd9JC8sXG4gICAgICAnZWwtR1InOiAvXihcXCszMCk/KCgyXFxkezl9KXwoNjlcXGR7OH0pKSQvLFxuICAgICAgJ2VuLUdCJzogL14oXFwrPzQ0fDApN1xcZHs5fSQvLFxuICAgICAgJ2VuLVVTJzogL14oXFwrPzEpP1syLTldXFxkezJ9WzItOV0oPyExMSlcXGR7Nn0kLyxcbiAgICAgICdlbi1aTSc6IC9eKFxcKzI2KT8wOVs1NjddXFxkezd9JC8sXG4gICAgICAncnUtUlUnOiAvXihcXCs/N3w4KT85XFxkezl9JC9cbiAgICB9O1xuXG4gICAgLy8gZnJvbSBodHRwOi8vZ29vLmdsLzBlakhIV1xuICAgIHZhciBpc284NjAxID0gL14oW1xcKy1dP1xcZHs0fSg/IVxcZHsyfVxcYikpKCgtPykoKDBbMS05XXwxWzAtMl0pKFxcMyhbMTJdXFxkfDBbMS05XXwzWzAxXSkpP3xXKFswLTRdXFxkfDVbMC0yXSkoLT9bMS03XSk/fCgwMFsxLTldfDBbMS05XVxcZHxbMTJdXFxkezJ9fDMoWzAtNV1cXGR8NlsxLTZdKSkpKFtUXFxzXSgoKFswMV1cXGR8MlswLTNdKSgoOj8pWzAtNV1cXGQpP3wyNFxcOj8wMCkoW1xcLixdXFxkKyg/ITopKT8pPyhcXDE3WzAtNV1cXGQoW1xcLixdXFxkKyk/KT8oW3paXXwoW1xcKy1dKShbMDFdXFxkfDJbMC0zXSk6PyhbMC01XVxcZCk/KT8pPyk/JC87XG5cbiAgICB2YWxpZGF0b3IuZXh0ZW5kID0gZnVuY3Rpb24gKG5hbWUsIGZuKSB7XG4gICAgICAgIHZhbGlkYXRvcltuYW1lXSA9IGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICAgIHZhciBhcmdzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKTtcbiAgICAgICAgICAgIGFyZ3NbMF0gPSB2YWxpZGF0b3IudG9TdHJpbmcoYXJnc1swXSk7XG4gICAgICAgICAgICByZXR1cm4gZm4uYXBwbHkodmFsaWRhdG9yLCBhcmdzKTtcbiAgICAgICAgfTtcbiAgICB9O1xuXG4gICAgLy9SaWdodCBiZWZvcmUgZXhwb3J0aW5nIHRoZSB2YWxpZGF0b3Igb2JqZWN0LCBwYXNzIGVhY2ggb2YgdGhlIGJ1aWx0aW5zXG4gICAgLy90aHJvdWdoIGV4dGVuZCgpIHNvIHRoYXQgdGhlaXIgZmlyc3QgYXJndW1lbnQgaXMgY29lcmNlZCB0byBhIHN0cmluZ1xuICAgIHZhbGlkYXRvci5pbml0ID0gZnVuY3Rpb24gKCkge1xuICAgICAgICBmb3IgKHZhciBuYW1lIGluIHZhbGlkYXRvcikge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiB2YWxpZGF0b3JbbmFtZV0gIT09ICdmdW5jdGlvbicgfHwgbmFtZSA9PT0gJ3RvU3RyaW5nJyB8fFxuICAgICAgICAgICAgICAgICAgICBuYW1lID09PSAndG9EYXRlJyB8fCBuYW1lID09PSAnZXh0ZW5kJyB8fCBuYW1lID09PSAnaW5pdCcpIHtcbiAgICAgICAgICAgICAgICBjb250aW51ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHZhbGlkYXRvci5leHRlbmQobmFtZSwgdmFsaWRhdG9yW25hbWVdKTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICB2YWxpZGF0b3IudG9TdHJpbmcgPSBmdW5jdGlvbiAoaW5wdXQpIHtcbiAgICAgICAgaWYgKHR5cGVvZiBpbnB1dCA9PT0gJ29iamVjdCcgJiYgaW5wdXQgIT09IG51bGwgJiYgaW5wdXQudG9TdHJpbmcpIHtcbiAgICAgICAgICAgIGlucHV0ID0gaW5wdXQudG9TdHJpbmcoKTtcbiAgICAgICAgfSBlbHNlIGlmIChpbnB1dCA9PT0gbnVsbCB8fCB0eXBlb2YgaW5wdXQgPT09ICd1bmRlZmluZWQnIHx8IChpc05hTihpbnB1dCkgJiYgIWlucHV0Lmxlbmd0aCkpIHtcbiAgICAgICAgICAgIGlucHV0ID0gJyc7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGlucHV0ICE9PSAnc3RyaW5nJykge1xuICAgICAgICAgICAgaW5wdXQgKz0gJyc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGlucHV0O1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IudG9EYXRlID0gZnVuY3Rpb24gKGRhdGUpIHtcbiAgICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChkYXRlKSA9PT0gJ1tvYmplY3QgRGF0ZV0nKSB7XG4gICAgICAgICAgICByZXR1cm4gZGF0ZTtcbiAgICAgICAgfVxuICAgICAgICBkYXRlID0gRGF0ZS5wYXJzZShkYXRlKTtcbiAgICAgICAgcmV0dXJuICFpc05hTihkYXRlKSA/IG5ldyBEYXRlKGRhdGUpIDogbnVsbDtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLnRvRmxvYXQgPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgICAgIHJldHVybiBwYXJzZUZsb2F0KHN0cik7XG4gICAgfTtcblxuICAgIHZhbGlkYXRvci50b0ludCA9IGZ1bmN0aW9uIChzdHIsIHJhZGl4KSB7XG4gICAgICAgIHJldHVybiBwYXJzZUludChzdHIsIHJhZGl4IHx8IDEwKTtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLnRvQm9vbGVhbiA9IGZ1bmN0aW9uIChzdHIsIHN0cmljdCkge1xuICAgICAgICBpZiAoc3RyaWN0KSB7XG4gICAgICAgICAgICByZXR1cm4gc3RyID09PSAnMScgfHwgc3RyID09PSAndHJ1ZSc7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHN0ciAhPT0gJzAnICYmIHN0ciAhPT0gJ2ZhbHNlJyAmJiBzdHIgIT09ICcnO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuZXF1YWxzID0gZnVuY3Rpb24gKHN0ciwgY29tcGFyaXNvbikge1xuICAgICAgICByZXR1cm4gc3RyID09PSB2YWxpZGF0b3IudG9TdHJpbmcoY29tcGFyaXNvbik7XG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5jb250YWlucyA9IGZ1bmN0aW9uIChzdHIsIGVsZW0pIHtcbiAgICAgICAgcmV0dXJuIHN0ci5pbmRleE9mKHZhbGlkYXRvci50b1N0cmluZyhlbGVtKSkgPj0gMDtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLm1hdGNoZXMgPSBmdW5jdGlvbiAoc3RyLCBwYXR0ZXJuLCBtb2RpZmllcnMpIHtcbiAgICAgICAgaWYgKE9iamVjdC5wcm90b3R5cGUudG9TdHJpbmcuY2FsbChwYXR0ZXJuKSAhPT0gJ1tvYmplY3QgUmVnRXhwXScpIHtcbiAgICAgICAgICAgIHBhdHRlcm4gPSBuZXcgUmVnRXhwKHBhdHRlcm4sIG1vZGlmaWVycyk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHBhdHRlcm4udGVzdChzdHIpO1xuICAgIH07XG5cbiAgICB2YXIgZGVmYXVsdF9lbWFpbF9vcHRpb25zID0ge1xuICAgICAgICBhbGxvd19kaXNwbGF5X25hbWU6IGZhbHNlLFxuICAgICAgICBhbGxvd191dGY4X2xvY2FsX3BhcnQ6IHRydWUsXG4gICAgICAgIHJlcXVpcmVfdGxkOiB0cnVlXG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5pc0VtYWlsID0gZnVuY3Rpb24gKHN0ciwgb3B0aW9ucykge1xuICAgICAgICBvcHRpb25zID0gbWVyZ2Uob3B0aW9ucywgZGVmYXVsdF9lbWFpbF9vcHRpb25zKTtcblxuICAgICAgICBpZiAob3B0aW9ucy5hbGxvd19kaXNwbGF5X25hbWUpIHtcbiAgICAgICAgICAgIHZhciBkaXNwbGF5X2VtYWlsID0gc3RyLm1hdGNoKGRpc3BsYXlOYW1lKTtcbiAgICAgICAgICAgIGlmIChkaXNwbGF5X2VtYWlsKSB7XG4gICAgICAgICAgICAgICAgc3RyID0gZGlzcGxheV9lbWFpbFsxXTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuXG4gICAgICAgIHZhciBwYXJ0cyA9IHN0ci5zcGxpdCgnQCcpXG4gICAgICAgICAgLCBkb21haW4gPSBwYXJ0cy5wb3AoKVxuICAgICAgICAgICwgdXNlciA9IHBhcnRzLmpvaW4oJ0AnKTtcblxuICAgICAgICB2YXIgbG93ZXJfZG9tYWluID0gZG9tYWluLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlmIChsb3dlcl9kb21haW4gPT09ICdnbWFpbC5jb20nIHx8IGxvd2VyX2RvbWFpbiA9PT0gJ2dvb2dsZW1haWwuY29tJykge1xuICAgICAgICAgICAgdXNlciA9IHVzZXIucmVwbGFjZSgvXFwuL2csICcnKS50b0xvd2VyQ2FzZSgpO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF2YWxpZGF0b3IuaXNCeXRlTGVuZ3RoKHVzZXIsIDAsIDY0KSB8fFxuICAgICAgICAgICAgICAgICF2YWxpZGF0b3IuaXNCeXRlTGVuZ3RoKGRvbWFpbiwgMCwgMjU2KSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgaWYgKCF2YWxpZGF0b3IuaXNGUUROKGRvbWFpbiwge3JlcXVpcmVfdGxkOiBvcHRpb25zLnJlcXVpcmVfdGxkfSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuXG4gICAgICAgIGlmICh1c2VyWzBdID09PSAnXCInKSB7XG4gICAgICAgICAgICB1c2VyID0gdXNlci5zbGljZSgxLCB1c2VyLmxlbmd0aCAtIDEpO1xuICAgICAgICAgICAgcmV0dXJuIG9wdGlvbnMuYWxsb3dfdXRmOF9sb2NhbF9wYXJ0ID9cbiAgICAgICAgICAgICAgICBxdW90ZWRFbWFpbFVzZXJVdGY4LnRlc3QodXNlcikgOlxuICAgICAgICAgICAgICAgIHF1b3RlZEVtYWlsVXNlci50ZXN0KHVzZXIpO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIHBhdHRlcm4gPSBvcHRpb25zLmFsbG93X3V0ZjhfbG9jYWxfcGFydCA/XG4gICAgICAgICAgICBlbWFpbFVzZXJVdGY4UGFydCA6IGVtYWlsVXNlclBhcnQ7XG5cbiAgICAgICAgdmFyIHVzZXJfcGFydHMgPSB1c2VyLnNwbGl0KCcuJyk7XG4gICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgdXNlcl9wYXJ0cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgaWYgKCFwYXR0ZXJuLnRlc3QodXNlcl9wYXJ0c1tpXSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICB9O1xuXG4gICAgdmFyIGRlZmF1bHRfdXJsX29wdGlvbnMgPSB7XG4gICAgICAgIHByb3RvY29sczogWyAnaHR0cCcsICdodHRwcycsICdmdHAnIF1cbiAgICAgICwgcmVxdWlyZV90bGQ6IHRydWVcbiAgICAgICwgcmVxdWlyZV9wcm90b2NvbDogZmFsc2VcbiAgICAgICwgcmVxdWlyZV92YWxpZF9wcm90b2NvbDogdHJ1ZVxuICAgICAgLCBhbGxvd191bmRlcnNjb3JlczogZmFsc2VcbiAgICAgICwgYWxsb3dfdHJhaWxpbmdfZG90OiBmYWxzZVxuICAgICAgLCBhbGxvd19wcm90b2NvbF9yZWxhdGl2ZV91cmxzOiBmYWxzZVxuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNVUkwgPSBmdW5jdGlvbiAodXJsLCBvcHRpb25zKSB7XG4gICAgICAgIGlmICghdXJsIHx8IHVybC5sZW5ndGggPj0gMjA4MyB8fCAvXFxzLy50ZXN0KHVybCkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICBpZiAodXJsLmluZGV4T2YoJ21haWx0bzonKSA9PT0gMCkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIG9wdGlvbnMgPSBtZXJnZShvcHRpb25zLCBkZWZhdWx0X3VybF9vcHRpb25zKTtcbiAgICAgICAgdmFyIHByb3RvY29sLCBhdXRoLCBob3N0LCBob3N0bmFtZSwgcG9ydCxcbiAgICAgICAgICAgIHBvcnRfc3RyLCBzcGxpdDtcbiAgICAgICAgc3BsaXQgPSB1cmwuc3BsaXQoJzovLycpO1xuICAgICAgICBpZiAoc3BsaXQubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgcHJvdG9jb2wgPSBzcGxpdC5zaGlmdCgpO1xuICAgICAgICAgICAgaWYgKG9wdGlvbnMucmVxdWlyZV92YWxpZF9wcm90b2NvbCAmJiBvcHRpb25zLnByb3RvY29scy5pbmRleE9mKHByb3RvY29sKSA9PT0gLTEpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH0gZWxzZSBpZiAob3B0aW9ucy5yZXF1aXJlX3Byb3RvY29sKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH0gIGVsc2UgaWYgKG9wdGlvbnMuYWxsb3dfcHJvdG9jb2xfcmVsYXRpdmVfdXJscyAmJiB1cmwuc3Vic3RyKDAsIDIpID09PSAnLy8nKSB7XG4gICAgICAgICAgICBzcGxpdFswXSA9IHVybC5zdWJzdHIoMik7XG4gICAgICAgIH1cbiAgICAgICAgdXJsID0gc3BsaXQuam9pbignOi8vJyk7XG4gICAgICAgIHNwbGl0ID0gdXJsLnNwbGl0KCcjJyk7XG4gICAgICAgIHVybCA9IHNwbGl0LnNoaWZ0KCk7XG5cbiAgICAgICAgc3BsaXQgPSB1cmwuc3BsaXQoJz8nKTtcbiAgICAgICAgdXJsID0gc3BsaXQuc2hpZnQoKTtcblxuICAgICAgICBzcGxpdCA9IHVybC5zcGxpdCgnLycpO1xuICAgICAgICB1cmwgPSBzcGxpdC5zaGlmdCgpO1xuICAgICAgICBzcGxpdCA9IHVybC5zcGxpdCgnQCcpO1xuICAgICAgICBpZiAoc3BsaXQubGVuZ3RoID4gMSkge1xuICAgICAgICAgICAgYXV0aCA9IHNwbGl0LnNoaWZ0KCk7XG4gICAgICAgICAgICBpZiAoYXV0aC5pbmRleE9mKCc6JykgPj0gMCAmJiBhdXRoLnNwbGl0KCc6JykubGVuZ3RoID4gMikge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBob3N0bmFtZSA9IHNwbGl0LmpvaW4oJ0AnKTtcbiAgICAgICAgc3BsaXQgPSBob3N0bmFtZS5zcGxpdCgnOicpO1xuICAgICAgICBob3N0ID0gc3BsaXQuc2hpZnQoKTtcbiAgICAgICAgaWYgKHNwbGl0Lmxlbmd0aCkge1xuICAgICAgICAgICAgcG9ydF9zdHIgPSBzcGxpdC5qb2luKCc6Jyk7XG4gICAgICAgICAgICBwb3J0ID0gcGFyc2VJbnQocG9ydF9zdHIsIDEwKTtcbiAgICAgICAgICAgIGlmICghL15bMC05XSskLy50ZXN0KHBvcnRfc3RyKSB8fCBwb3J0IDw9IDAgfHwgcG9ydCA+IDY1NTM1KSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICAgIGlmICghdmFsaWRhdG9yLmlzSVAoaG9zdCkgJiYgIXZhbGlkYXRvci5pc0ZRRE4oaG9zdCwgb3B0aW9ucykgJiZcbiAgICAgICAgICAgICAgICBob3N0ICE9PSAnbG9jYWxob3N0Jykge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcHRpb25zLmhvc3Rfd2hpdGVsaXN0ICYmXG4gICAgICAgICAgICAgICAgb3B0aW9ucy5ob3N0X3doaXRlbGlzdC5pbmRleE9mKGhvc3QpID09PSAtMSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcHRpb25zLmhvc3RfYmxhY2tsaXN0ICYmXG4gICAgICAgICAgICAgICAgb3B0aW9ucy5ob3N0X2JsYWNrbGlzdC5pbmRleE9mKGhvc3QpICE9PSAtMSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiB0cnVlO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNJUCA9IGZ1bmN0aW9uIChzdHIsIHZlcnNpb24pIHtcbiAgICAgICAgdmVyc2lvbiA9IHZhbGlkYXRvci50b1N0cmluZyh2ZXJzaW9uKTtcbiAgICAgICAgaWYgKCF2ZXJzaW9uKSB7XG4gICAgICAgICAgICByZXR1cm4gdmFsaWRhdG9yLmlzSVAoc3RyLCA0KSB8fCB2YWxpZGF0b3IuaXNJUChzdHIsIDYpO1xuICAgICAgICB9IGVsc2UgaWYgKHZlcnNpb24gPT09ICc0Jykge1xuICAgICAgICAgICAgaWYgKCFpcHY0TWF5YmUudGVzdChzdHIpKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgdmFyIHBhcnRzID0gc3RyLnNwbGl0KCcuJykuc29ydChmdW5jdGlvbiAoYSwgYikge1xuICAgICAgICAgICAgICAgIHJldHVybiBhIC0gYjtcbiAgICAgICAgICAgIH0pO1xuICAgICAgICAgICAgcmV0dXJuIHBhcnRzWzNdIDw9IDI1NTtcbiAgICAgICAgfSBlbHNlIGlmICh2ZXJzaW9uID09PSAnNicpIHtcbiAgICAgICAgICAgIHZhciBibG9ja3MgPSBzdHIuc3BsaXQoJzonKTtcbiAgICAgICAgICAgIHZhciBmb3VuZE9taXNzaW9uQmxvY2sgPSBmYWxzZTsgLy8gbWFya2VyIHRvIGluZGljYXRlIDo6XG5cbiAgICAgICAgICAgIC8vIEF0IGxlYXN0IHNvbWUgT1MgYWNjZXB0IHRoZSBsYXN0IDMyIGJpdHMgb2YgYW4gSVB2NiBhZGRyZXNzXG4gICAgICAgICAgICAvLyAoaS5lLiAyIG9mIHRoZSBibG9ja3MpIGluIElQdjQgbm90YXRpb24sIGFuZCBSRkMgMzQ5MyBzYXlzXG4gICAgICAgICAgICAvLyB0aGF0ICc6OmZmZmY6YS5iLmMuZCcgaXMgdmFsaWQgZm9yIElQdjQtbWFwcGVkIElQdjYgYWRkcmVzc2VzLFxuICAgICAgICAgICAgLy8gYW5kICc6OmEuYi5jLmQnIGlzIGRlcHJlY2F0ZWQsIGJ1dCBhbHNvIHZhbGlkLlxuICAgICAgICAgICAgdmFyIGZvdW5kSVB2NFRyYW5zaXRpb25CbG9jayA9IHZhbGlkYXRvci5pc0lQKGJsb2Nrc1tibG9ja3MubGVuZ3RoIC0gMV0sIDQpO1xuICAgICAgICAgICAgdmFyIGV4cGVjdGVkTnVtYmVyT2ZCbG9ja3MgPSBmb3VuZElQdjRUcmFuc2l0aW9uQmxvY2sgPyA3IDogODtcblxuICAgICAgICAgICAgaWYgKGJsb2Nrcy5sZW5ndGggPiBleHBlY3RlZE51bWJlck9mQmxvY2tzKVxuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcblxuICAgICAgICAgICAgLy8gaW5pdGlhbCBvciBmaW5hbCA6OlxuICAgICAgICAgICAgaWYgKHN0ciA9PT0gJzo6Jykge1xuICAgICAgICAgICAgICAgIHJldHVybiB0cnVlO1xuICAgICAgICAgICAgfSBlbHNlIGlmIChzdHIuc3Vic3RyKDAsIDIpID09PSAnOjonKSB7XG4gICAgICAgICAgICAgICAgYmxvY2tzLnNoaWZ0KCk7XG4gICAgICAgICAgICAgICAgYmxvY2tzLnNoaWZ0KCk7XG4gICAgICAgICAgICAgICAgZm91bmRPbWlzc2lvbkJsb2NrID0gdHJ1ZTtcbiAgICAgICAgICAgIH0gZWxzZSBpZiAoc3RyLnN1YnN0cihzdHIubGVuZ3RoIC0gMikgPT09ICc6OicpIHtcbiAgICAgICAgICAgICAgICBibG9ja3MucG9wKCk7XG4gICAgICAgICAgICAgICAgYmxvY2tzLnBvcCgpO1xuICAgICAgICAgICAgICAgIGZvdW5kT21pc3Npb25CbG9jayA9IHRydWU7XG4gICAgICAgICAgICB9XG5cbiAgICAgICAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgYmxvY2tzLmxlbmd0aDsgKytpKSB7XG4gICAgICAgICAgICAgICAgLy8gdGVzdCBmb3IgYSA6OiB3aGljaCBjYW4gbm90IGJlIGF0IHRoZSBzdHJpbmcgc3RhcnQvZW5kXG4gICAgICAgICAgICAgICAgLy8gc2luY2UgdGhvc2UgY2FzZXMgaGF2ZSBiZWVuIGhhbmRsZWQgYWJvdmVcbiAgICAgICAgICAgICAgICBpZiAoYmxvY2tzW2ldID09PSAnJyAmJiBpID4gMCAmJiBpIDwgYmxvY2tzLmxlbmd0aCAtMSkge1xuICAgICAgICAgICAgICAgICAgICBpZiAoZm91bmRPbWlzc2lvbkJsb2NrKVxuICAgICAgICAgICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlOyAvLyBtdWx0aXBsZSA6OiBpbiBhZGRyZXNzXG4gICAgICAgICAgICAgICAgICAgIGZvdW5kT21pc3Npb25CbG9jayA9IHRydWU7XG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmIChmb3VuZElQdjRUcmFuc2l0aW9uQmxvY2sgJiYgaSA9PSBibG9ja3MubGVuZ3RoIC0gMSkge1xuICAgICAgICAgICAgICAgICAgICAvLyBpdCBoYXMgYmVlbiBjaGVja2VkIGJlZm9yZSB0aGF0IHRoZSBsYXN0XG4gICAgICAgICAgICAgICAgICAgIC8vIGJsb2NrIGlzIGEgdmFsaWQgSVB2NCBhZGRyZXNzXG4gICAgICAgICAgICAgICAgfSBlbHNlIGlmICghaXB2NkJsb2NrLnRlc3QoYmxvY2tzW2ldKSkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfVxuXG4gICAgICAgICAgICBpZiAoZm91bmRPbWlzc2lvbkJsb2NrKSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGJsb2Nrcy5sZW5ndGggPj0gMTtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgcmV0dXJuIGJsb2Nrcy5sZW5ndGggPT09IGV4cGVjdGVkTnVtYmVyT2ZCbG9ja3M7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH07XG5cbiAgICB2YXIgZGVmYXVsdF9mcWRuX29wdGlvbnMgPSB7XG4gICAgICAgIHJlcXVpcmVfdGxkOiB0cnVlXG4gICAgICAsIGFsbG93X3VuZGVyc2NvcmVzOiBmYWxzZVxuICAgICAgLCBhbGxvd190cmFpbGluZ19kb3Q6IGZhbHNlXG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5pc0ZRRE4gPSBmdW5jdGlvbiAoc3RyLCBvcHRpb25zKSB7XG4gICAgICAgIG9wdGlvbnMgPSBtZXJnZShvcHRpb25zLCBkZWZhdWx0X2ZxZG5fb3B0aW9ucyk7XG5cbiAgICAgICAgLyogUmVtb3ZlIHRoZSBvcHRpb25hbCB0cmFpbGluZyBkb3QgYmVmb3JlIGNoZWNraW5nIHZhbGlkaXR5ICovXG4gICAgICAgIGlmIChvcHRpb25zLmFsbG93X3RyYWlsaW5nX2RvdCAmJiBzdHJbc3RyLmxlbmd0aCAtIDFdID09PSAnLicpIHtcbiAgICAgICAgICAgIHN0ciA9IHN0ci5zdWJzdHJpbmcoMCwgc3RyLmxlbmd0aCAtIDEpO1xuICAgICAgICB9XG4gICAgICAgIHZhciBwYXJ0cyA9IHN0ci5zcGxpdCgnLicpO1xuICAgICAgICBpZiAob3B0aW9ucy5yZXF1aXJlX3RsZCkge1xuICAgICAgICAgICAgdmFyIHRsZCA9IHBhcnRzLnBvcCgpO1xuICAgICAgICAgICAgaWYgKCFwYXJ0cy5sZW5ndGggfHwgIS9eKFthLXpcXHUwMGExLVxcdWZmZmZdezIsfXx4blthLXowLTktXXsyLH0pJC9pLnRlc3QodGxkKSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICBmb3IgKHZhciBwYXJ0LCBpID0gMDsgaSA8IHBhcnRzLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgICAgICBwYXJ0ID0gcGFydHNbaV07XG4gICAgICAgICAgICBpZiAob3B0aW9ucy5hbGxvd191bmRlcnNjb3Jlcykge1xuICAgICAgICAgICAgICAgIGlmIChwYXJ0LmluZGV4T2YoJ19fJykgPj0gMCkge1xuICAgICAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgICAgIHBhcnQgPSBwYXJ0LnJlcGxhY2UoL18vZywgJycpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKCEvXlthLXpcXHUwMGExLVxcdWZmZmYwLTktXSskL2kudGVzdChwYXJ0KSkge1xuICAgICAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGlmICgvW1xcdWZmMDEtXFx1ZmY1ZV0vLnRlc3QocGFydCkpIHtcbiAgICAgICAgICAgICAgICAvLyBkaXNhbGxvdyBmdWxsLXdpZHRoIGNoYXJzXG4gICAgICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHBhcnRbMF0gPT09ICctJyB8fCBwYXJ0W3BhcnQubGVuZ3RoIC0gMV0gPT09ICctJyB8fFxuICAgICAgICAgICAgICAgICAgICBwYXJ0LmluZGV4T2YoJy0tLScpID49IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5pc0Jvb2xlYW4gPSBmdW5jdGlvbihzdHIpIHtcbiAgICAgICAgcmV0dXJuIChbJ3RydWUnLCAnZmFsc2UnLCAnMScsICcwJ10uaW5kZXhPZihzdHIpID49IDApO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNBbHBoYSA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAgICAgcmV0dXJuIGFscGhhLnRlc3Qoc3RyKTtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLmlzQWxwaGFudW1lcmljID0gZnVuY3Rpb24gKHN0cikge1xuICAgICAgICByZXR1cm4gYWxwaGFudW1lcmljLnRlc3Qoc3RyKTtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLmlzTnVtZXJpYyA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAgICAgcmV0dXJuIG51bWVyaWMudGVzdChzdHIpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNEZWNpbWFsID0gZnVuY3Rpb24gKHN0cikge1xuICAgICAgICByZXR1cm4gc3RyICE9PSAnJyAmJiBkZWNpbWFsLnRlc3Qoc3RyKTtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLmlzSGV4YWRlY2ltYWwgPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgICAgIHJldHVybiBoZXhhZGVjaW1hbC50ZXN0KHN0cik7XG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5pc0hleENvbG9yID0gZnVuY3Rpb24gKHN0cikge1xuICAgICAgICByZXR1cm4gaGV4Y29sb3IudGVzdChzdHIpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNMb3dlcmNhc2UgPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgICAgIHJldHVybiBzdHIgPT09IHN0ci50b0xvd2VyQ2FzZSgpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNVcHBlcmNhc2UgPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgICAgIHJldHVybiBzdHIgPT09IHN0ci50b1VwcGVyQ2FzZSgpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNJbnQgPSBmdW5jdGlvbiAoc3RyLCBvcHRpb25zKSB7XG4gICAgICAgIG9wdGlvbnMgPSBvcHRpb25zIHx8IHt9O1xuICAgICAgICByZXR1cm4gaW50LnRlc3Qoc3RyKSAmJiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ21pbicpIHx8IHN0ciA+PSBvcHRpb25zLm1pbikgJiYgKCFvcHRpb25zLmhhc093blByb3BlcnR5KCdtYXgnKSB8fCBzdHIgPD0gb3B0aW9ucy5tYXgpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNGbG9hdCA9IGZ1bmN0aW9uIChzdHIsIG9wdGlvbnMpIHtcbiAgICAgICAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gICAgICAgIHJldHVybiBzdHIgIT09ICcnICYmIGZsb2F0LnRlc3Qoc3RyKSAmJiAoIW9wdGlvbnMuaGFzT3duUHJvcGVydHkoJ21pbicpIHx8IHN0ciA+PSBvcHRpb25zLm1pbikgJiYgKCFvcHRpb25zLmhhc093blByb3BlcnR5KCdtYXgnKSB8fCBzdHIgPD0gb3B0aW9ucy5tYXgpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNEaXZpc2libGVCeSA9IGZ1bmN0aW9uIChzdHIsIG51bSkge1xuICAgICAgICByZXR1cm4gdmFsaWRhdG9yLnRvRmxvYXQoc3RyKSAlIHZhbGlkYXRvci50b0ludChudW0pID09PSAwO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNOdWxsID0gZnVuY3Rpb24gKHN0cikge1xuICAgICAgICByZXR1cm4gc3RyLmxlbmd0aCA9PT0gMDtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLmlzTGVuZ3RoID0gZnVuY3Rpb24gKHN0ciwgbWluLCBtYXgpIHtcbiAgICAgICAgdmFyIHN1cnJvZ2F0ZVBhaXJzID0gc3RyLm1hdGNoKC9bXFx1RDgwMC1cXHVEQkZGXVtcXHVEQzAwLVxcdURGRkZdL2cpIHx8IFtdO1xuICAgICAgICB2YXIgbGVuID0gc3RyLmxlbmd0aCAtIHN1cnJvZ2F0ZVBhaXJzLmxlbmd0aDtcbiAgICAgICAgcmV0dXJuIGxlbiA+PSBtaW4gJiYgKHR5cGVvZiBtYXggPT09ICd1bmRlZmluZWQnIHx8IGxlbiA8PSBtYXgpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNCeXRlTGVuZ3RoID0gZnVuY3Rpb24gKHN0ciwgbWluLCBtYXgpIHtcbiAgICAgICAgdmFyIGxlbiA9IGVuY29kZVVSSShzdHIpLnNwbGl0KC8lLi58Li8pLmxlbmd0aCAtIDE7XG4gICAgICAgIHJldHVybiBsZW4gPj0gbWluICYmICh0eXBlb2YgbWF4ID09PSAndW5kZWZpbmVkJyB8fCBsZW4gPD0gbWF4KTtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLmlzVVVJRCA9IGZ1bmN0aW9uIChzdHIsIHZlcnNpb24pIHtcbiAgICAgICAgdmFyIHBhdHRlcm4gPSB1dWlkW3ZlcnNpb24gPyB2ZXJzaW9uIDogJ2FsbCddO1xuICAgICAgICByZXR1cm4gcGF0dGVybiAmJiBwYXR0ZXJuLnRlc3Qoc3RyKTtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLmlzRGF0ZSA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAgICAgdmFyIG5vcm1hbGl6ZWREYXRlID0gbmV3IERhdGUoKG5ldyBEYXRlKHN0cikpLnRvVVRDU3RyaW5nKCkpO1xuICAgICAgICB2YXIgcmVndWxhckRheSA9IFN0cmluZyhub3JtYWxpemVkRGF0ZS5nZXREYXRlKCkpO1xuICAgICAgICB2YXIgdXRjRGF5ID0gU3RyaW5nKG5vcm1hbGl6ZWREYXRlLmdldFVUQ0RhdGUoKSk7XG4gICAgICAgIHZhciBkYXlPclllYXIsIGRheU9yWWVhck1hdGNoZXMsIHllYXI7XG4gICAgICAgIGlmIChpc05hTihEYXRlLnBhcnNlKG5vcm1hbGl6ZWREYXRlKSkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICAvL2NoZWNrIGZvciB2YWxpZCBkb3VibGUgZGlnaXRzIHRoYXQgY291bGQgYmUgbGF0ZSBkYXlzXG4gICAgICAgIC8vY2hlY2sgZm9yIGFsbCBtYXRjaGVzIHNpbmNlIGEgc3RyaW5nIGxpa2UgJzEyLzIzJyBpcyBhIHZhbGlkIGRhdGVcbiAgICAgICAgLy9pZ25vcmUgZXZlcnl0aGluZyB3aXRoIG5lYXJieSBjb2xvbnNcbiAgICAgICAgZGF5T3JZZWFyTWF0Y2hlcyA9IHN0ci5tYXRjaCgvKF58W146XFxkXSlbMjNdXFxkKFteOlxcZF18JCkvZyk7XG4gICAgICAgIGlmICghZGF5T3JZZWFyTWF0Y2hlcykge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH1cbiAgICAgICAgZGF5T3JZZWFyID0gZGF5T3JZZWFyTWF0Y2hlcy5tYXAoZnVuY3Rpb24oZGlnaXRTdHJpbmcpIHtcbiAgICAgICAgICAgIHJldHVybiBkaWdpdFN0cmluZy5tYXRjaCgvXFxkKy9nKVswXTtcbiAgICAgICAgfSkuam9pbignLycpO1xuICAgICAgICB5ZWFyID0gU3RyaW5nKG5vcm1hbGl6ZWREYXRlLmdldEZ1bGxZZWFyKCkpLnNsaWNlKC0yKTtcbiAgICAgICAgLy9sb2NhbCBkYXRlIGFuZCBVVEMgZGF0ZSBjYW4gZGlmZmVyLCBidXQgYm90aCBhcmUgdmFsaWQsIHNvIGNoZWNrIGFnYWlucyBib3RoXG4gICAgICAgIGlmIChkYXlPclllYXIgPT09IHJlZ3VsYXJEYXkgfHwgZGF5T3JZZWFyID09PSB1dGNEYXkgfHwgZGF5T3JZZWFyID09PSB5ZWFyKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIGlmICgoZGF5T3JZZWFyID09PSAocmVndWxhckRheSArICcvJyArIHllYXIpKSB8fCAoZGF5T3JZZWFyID09PSAoeWVhciArICcvJyArIHJlZ3VsYXJEYXkpKSkge1xuICAgICAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgICAgIH0gZWxzZSBpZiAoKGRheU9yWWVhciA9PT0gKHV0Y0RheSArICcvJyArIHllYXIpKSB8fCAoZGF5T3JZZWFyID09PSAoeWVhciArICcvJyArIHV0Y0RheSkpKSB7XG4gICAgICAgICAgICByZXR1cm4gdHJ1ZTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNBZnRlciA9IGZ1bmN0aW9uIChzdHIsIGRhdGUpIHtcbiAgICAgICAgdmFyIGNvbXBhcmlzb24gPSB2YWxpZGF0b3IudG9EYXRlKGRhdGUgfHwgbmV3IERhdGUoKSlcbiAgICAgICAgICAsIG9yaWdpbmFsID0gdmFsaWRhdG9yLnRvRGF0ZShzdHIpO1xuICAgICAgICByZXR1cm4gISEob3JpZ2luYWwgJiYgY29tcGFyaXNvbiAmJiBvcmlnaW5hbCA+IGNvbXBhcmlzb24pO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNCZWZvcmUgPSBmdW5jdGlvbiAoc3RyLCBkYXRlKSB7XG4gICAgICAgIHZhciBjb21wYXJpc29uID0gdmFsaWRhdG9yLnRvRGF0ZShkYXRlIHx8IG5ldyBEYXRlKCkpXG4gICAgICAgICAgLCBvcmlnaW5hbCA9IHZhbGlkYXRvci50b0RhdGUoc3RyKTtcbiAgICAgICAgcmV0dXJuICEhKG9yaWdpbmFsICYmIGNvbXBhcmlzb24gJiYgb3JpZ2luYWwgPCBjb21wYXJpc29uKTtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLmlzSW4gPSBmdW5jdGlvbiAoc3RyLCBvcHRpb25zKSB7XG4gICAgICAgIHZhciBpO1xuICAgICAgICBpZiAoT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZy5jYWxsKG9wdGlvbnMpID09PSAnW29iamVjdCBBcnJheV0nKSB7XG4gICAgICAgICAgICB2YXIgYXJyYXkgPSBbXTtcbiAgICAgICAgICAgIGZvciAoaSBpbiBvcHRpb25zKSB7XG4gICAgICAgICAgICAgICAgYXJyYXlbaV0gPSB2YWxpZGF0b3IudG9TdHJpbmcob3B0aW9uc1tpXSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICByZXR1cm4gYXJyYXkuaW5kZXhPZihzdHIpID49IDA7XG4gICAgICAgIH0gZWxzZSBpZiAodHlwZW9mIG9wdGlvbnMgPT09ICdvYmplY3QnKSB7XG4gICAgICAgICAgICByZXR1cm4gb3B0aW9ucy5oYXNPd25Qcm9wZXJ0eShzdHIpO1xuICAgICAgICB9IGVsc2UgaWYgKG9wdGlvbnMgJiYgdHlwZW9mIG9wdGlvbnMuaW5kZXhPZiA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICAgICAgcmV0dXJuIG9wdGlvbnMuaW5kZXhPZihzdHIpID49IDA7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNDcmVkaXRDYXJkID0gZnVuY3Rpb24gKHN0cikge1xuICAgICAgICB2YXIgc2FuaXRpemVkID0gc3RyLnJlcGxhY2UoL1teMC05XSsvZywgJycpO1xuICAgICAgICBpZiAoIWNyZWRpdENhcmQudGVzdChzYW5pdGl6ZWQpKSB7XG4gICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHN1bSA9IDAsIGRpZ2l0LCB0bXBOdW0sIHNob3VsZERvdWJsZTtcbiAgICAgICAgZm9yICh2YXIgaSA9IHNhbml0aXplZC5sZW5ndGggLSAxOyBpID49IDA7IGktLSkge1xuICAgICAgICAgICAgZGlnaXQgPSBzYW5pdGl6ZWQuc3Vic3RyaW5nKGksIChpICsgMSkpO1xuICAgICAgICAgICAgdG1wTnVtID0gcGFyc2VJbnQoZGlnaXQsIDEwKTtcbiAgICAgICAgICAgIGlmIChzaG91bGREb3VibGUpIHtcbiAgICAgICAgICAgICAgICB0bXBOdW0gKj0gMjtcbiAgICAgICAgICAgICAgICBpZiAodG1wTnVtID49IDEwKSB7XG4gICAgICAgICAgICAgICAgICAgIHN1bSArPSAoKHRtcE51bSAlIDEwKSArIDEpO1xuICAgICAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgICAgIHN1bSArPSB0bXBOdW07XG4gICAgICAgICAgICAgICAgfVxuICAgICAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgICAgICBzdW0gKz0gdG1wTnVtO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgc2hvdWxkRG91YmxlID0gIXNob3VsZERvdWJsZTtcbiAgICAgICAgfVxuICAgICAgICByZXR1cm4gISEoKHN1bSAlIDEwKSA9PT0gMCA/IHNhbml0aXplZCA6IGZhbHNlKTtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLmlzSVNJTiA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAgICAgaWYgKCFpc2luLnRlc3Qoc3RyKSkge1xuICAgICAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgICAgICB9XG5cbiAgICAgICAgdmFyIGNoZWNrc3VtU3RyID0gc3RyLnJlcGxhY2UoL1tBLVpdL2csIGZ1bmN0aW9uKGNoYXJhY3Rlcikge1xuICAgICAgICAgICAgcmV0dXJuIHBhcnNlSW50KGNoYXJhY3RlciwgMzYpO1xuICAgICAgICB9KTtcblxuICAgICAgICB2YXIgc3VtID0gMCwgZGlnaXQsIHRtcE51bSwgc2hvdWxkRG91YmxlID0gdHJ1ZTtcbiAgICAgICAgZm9yICh2YXIgaSA9IGNoZWNrc3VtU3RyLmxlbmd0aCAtIDI7IGkgPj0gMDsgaS0tKSB7XG4gICAgICAgICAgICBkaWdpdCA9IGNoZWNrc3VtU3RyLnN1YnN0cmluZyhpLCAoaSArIDEpKTtcbiAgICAgICAgICAgIHRtcE51bSA9IHBhcnNlSW50KGRpZ2l0LCAxMCk7XG4gICAgICAgICAgICBpZiAoc2hvdWxkRG91YmxlKSB7XG4gICAgICAgICAgICAgICAgdG1wTnVtICo9IDI7XG4gICAgICAgICAgICAgICAgaWYgKHRtcE51bSA+PSAxMCkge1xuICAgICAgICAgICAgICAgICAgICBzdW0gKz0gdG1wTnVtICsgMTtcbiAgICAgICAgICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgICAgICAgICAgICBzdW0gKz0gdG1wTnVtO1xuICAgICAgICAgICAgICAgIH1cbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgc3VtICs9IHRtcE51bTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIHNob3VsZERvdWJsZSA9ICFzaG91bGREb3VibGU7XG4gICAgICAgIH1cblxuICAgICAgICByZXR1cm4gcGFyc2VJbnQoc3RyLnN1YnN0cihzdHIubGVuZ3RoIC0gMSksIDEwKSA9PT0gKDEwMDAwIC0gc3VtKSAlIDEwO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNJU0JOID0gZnVuY3Rpb24gKHN0ciwgdmVyc2lvbikge1xuICAgICAgICB2ZXJzaW9uID0gdmFsaWRhdG9yLnRvU3RyaW5nKHZlcnNpb24pO1xuICAgICAgICBpZiAoIXZlcnNpb24pIHtcbiAgICAgICAgICAgIHJldHVybiB2YWxpZGF0b3IuaXNJU0JOKHN0ciwgMTApIHx8IHZhbGlkYXRvci5pc0lTQk4oc3RyLCAxMyk7XG4gICAgICAgIH1cbiAgICAgICAgdmFyIHNhbml0aXplZCA9IHN0ci5yZXBsYWNlKC9bXFxzLV0rL2csICcnKVxuICAgICAgICAgICwgY2hlY2tzdW0gPSAwLCBpO1xuICAgICAgICBpZiAodmVyc2lvbiA9PT0gJzEwJykge1xuICAgICAgICAgICAgaWYgKCFpc2JuMTBNYXliZS50ZXN0KHNhbml0aXplZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBmb3IgKGkgPSAwOyBpIDwgOTsgaSsrKSB7XG4gICAgICAgICAgICAgICAgY2hlY2tzdW0gKz0gKGkgKyAxKSAqIHNhbml0aXplZC5jaGFyQXQoaSk7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBpZiAoc2FuaXRpemVkLmNoYXJBdCg5KSA9PT0gJ1gnKSB7XG4gICAgICAgICAgICAgICAgY2hlY2tzdW0gKz0gMTAgKiAxMDtcbiAgICAgICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgICAgICAgY2hlY2tzdW0gKz0gMTAgKiBzYW5pdGl6ZWQuY2hhckF0KDkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKChjaGVja3N1bSAlIDExKSA9PT0gMCkge1xuICAgICAgICAgICAgICAgIHJldHVybiAhIXNhbml0aXplZDtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfSBlbHNlICBpZiAodmVyc2lvbiA9PT0gJzEzJykge1xuICAgICAgICAgICAgaWYgKCFpc2JuMTNNYXliZS50ZXN0KHNhbml0aXplZCkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICB2YXIgZmFjdG9yID0gWyAxLCAzIF07XG4gICAgICAgICAgICBmb3IgKGkgPSAwOyBpIDwgMTI7IGkrKykge1xuICAgICAgICAgICAgICAgIGNoZWNrc3VtICs9IGZhY3RvcltpICUgMl0gKiBzYW5pdGl6ZWQuY2hhckF0KGkpO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgaWYgKHNhbml0aXplZC5jaGFyQXQoMTIpIC0gKCgxMCAtIChjaGVja3N1bSAlIDEwKSkgJSAxMCkgPT09IDApIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gISFzYW5pdGl6ZWQ7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNNb2JpbGVQaG9uZSA9IGZ1bmN0aW9uKHN0ciwgbG9jYWxlKSB7XG4gICAgICAgIGlmIChsb2NhbGUgaW4gcGhvbmVzKSB7XG4gICAgICAgICAgICByZXR1cm4gcGhvbmVzW2xvY2FsZV0udGVzdChzdHIpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9O1xuXG4gICAgdmFyIGRlZmF1bHRfY3VycmVuY3lfb3B0aW9ucyA9IHtcbiAgICAgICAgc3ltYm9sOiAnJCdcbiAgICAgICwgcmVxdWlyZV9zeW1ib2w6IGZhbHNlXG4gICAgICAsIGFsbG93X3NwYWNlX2FmdGVyX3N5bWJvbDogZmFsc2VcbiAgICAgICwgc3ltYm9sX2FmdGVyX2RpZ2l0czogZmFsc2VcbiAgICAgICwgYWxsb3dfbmVnYXRpdmVzOiB0cnVlXG4gICAgICAsIHBhcmVuc19mb3JfbmVnYXRpdmVzOiBmYWxzZVxuICAgICAgLCBuZWdhdGl2ZV9zaWduX2JlZm9yZV9kaWdpdHM6IGZhbHNlXG4gICAgICAsIG5lZ2F0aXZlX3NpZ25fYWZ0ZXJfZGlnaXRzOiBmYWxzZVxuICAgICAgLCBhbGxvd19uZWdhdGl2ZV9zaWduX3BsYWNlaG9sZGVyOiBmYWxzZVxuICAgICAgLCB0aG91c2FuZHNfc2VwYXJhdG9yOiAnLCdcbiAgICAgICwgZGVjaW1hbF9zZXBhcmF0b3I6ICcuJ1xuICAgICAgLCBhbGxvd19zcGFjZV9hZnRlcl9kaWdpdHM6IGZhbHNlXG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5pc0N1cnJlbmN5ID0gZnVuY3Rpb24gKHN0ciwgb3B0aW9ucykge1xuICAgICAgICBvcHRpb25zID0gbWVyZ2Uob3B0aW9ucywgZGVmYXVsdF9jdXJyZW5jeV9vcHRpb25zKTtcblxuICAgICAgICByZXR1cm4gY3VycmVuY3lSZWdleChvcHRpb25zKS50ZXN0KHN0cik7XG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5pc0pTT04gPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgICAgIHRyeSB7XG4gICAgICAgICAgICB2YXIgb2JqID0gSlNPTi5wYXJzZShzdHIpO1xuICAgICAgICAgICAgcmV0dXJuICEhb2JqICYmIHR5cGVvZiBvYmogPT09ICdvYmplY3QnO1xuICAgICAgICB9IGNhdGNoIChlKSB7fVxuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5pc011bHRpYnl0ZSA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAgICAgcmV0dXJuIG11bHRpYnl0ZS50ZXN0KHN0cik7XG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5pc0FzY2lpID0gZnVuY3Rpb24gKHN0cikge1xuICAgICAgICByZXR1cm4gYXNjaWkudGVzdChzdHIpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNGdWxsV2lkdGggPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgICAgIHJldHVybiBmdWxsV2lkdGgudGVzdChzdHIpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNIYWxmV2lkdGggPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgICAgIHJldHVybiBoYWxmV2lkdGgudGVzdChzdHIpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNWYXJpYWJsZVdpZHRoID0gZnVuY3Rpb24gKHN0cikge1xuICAgICAgICByZXR1cm4gZnVsbFdpZHRoLnRlc3Qoc3RyKSAmJiBoYWxmV2lkdGgudGVzdChzdHIpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNTdXJyb2dhdGVQYWlyID0gZnVuY3Rpb24gKHN0cikge1xuICAgICAgICByZXR1cm4gc3Vycm9nYXRlUGFpci50ZXN0KHN0cik7XG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5pc0Jhc2U2NCA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAgICAgcmV0dXJuIGJhc2U2NC50ZXN0KHN0cik7XG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5pc01vbmdvSWQgPSBmdW5jdGlvbiAoc3RyKSB7XG4gICAgICAgIHJldHVybiB2YWxpZGF0b3IuaXNIZXhhZGVjaW1hbChzdHIpICYmIHN0ci5sZW5ndGggPT09IDI0O1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuaXNJU084NjAxID0gZnVuY3Rpb24gKHN0cikge1xuICAgICAgICByZXR1cm4gaXNvODYwMS50ZXN0KHN0cik7XG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5sdHJpbSA9IGZ1bmN0aW9uIChzdHIsIGNoYXJzKSB7XG4gICAgICAgIHZhciBwYXR0ZXJuID0gY2hhcnMgPyBuZXcgUmVnRXhwKCdeWycgKyBjaGFycyArICddKycsICdnJykgOiAvXlxccysvZztcbiAgICAgICAgcmV0dXJuIHN0ci5yZXBsYWNlKHBhdHRlcm4sICcnKTtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLnJ0cmltID0gZnVuY3Rpb24gKHN0ciwgY2hhcnMpIHtcbiAgICAgICAgdmFyIHBhdHRlcm4gPSBjaGFycyA/IG5ldyBSZWdFeHAoJ1snICsgY2hhcnMgKyAnXSskJywgJ2cnKSA6IC9cXHMrJC9nO1xuICAgICAgICByZXR1cm4gc3RyLnJlcGxhY2UocGF0dGVybiwgJycpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IudHJpbSA9IGZ1bmN0aW9uIChzdHIsIGNoYXJzKSB7XG4gICAgICAgIHZhciBwYXR0ZXJuID0gY2hhcnMgPyBuZXcgUmVnRXhwKCdeWycgKyBjaGFycyArICddK3xbJyArIGNoYXJzICsgJ10rJCcsICdnJykgOiAvXlxccyt8XFxzKyQvZztcbiAgICAgICAgcmV0dXJuIHN0ci5yZXBsYWNlKHBhdHRlcm4sICcnKTtcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLmVzY2FwZSA9IGZ1bmN0aW9uIChzdHIpIHtcbiAgICAgICAgcmV0dXJuIChzdHIucmVwbGFjZSgvJi9nLCAnJmFtcDsnKVxuICAgICAgICAgICAgLnJlcGxhY2UoL1wiL2csICcmcXVvdDsnKVxuICAgICAgICAgICAgLnJlcGxhY2UoLycvZywgJyYjeDI3OycpXG4gICAgICAgICAgICAucmVwbGFjZSgvPC9nLCAnJmx0OycpXG4gICAgICAgICAgICAucmVwbGFjZSgvPi9nLCAnJmd0OycpXG4gICAgICAgICAgICAucmVwbGFjZSgvXFwvL2csICcmI3gyRjsnKVxuICAgICAgICAgICAgLnJlcGxhY2UoL1xcYC9nLCAnJiM5NjsnKSk7XG4gICAgfTtcblxuICAgIHZhbGlkYXRvci5zdHJpcExvdyA9IGZ1bmN0aW9uIChzdHIsIGtlZXBfbmV3X2xpbmVzKSB7XG4gICAgICAgIHZhciBjaGFycyA9IGtlZXBfbmV3X2xpbmVzID8gJ1xcXFx4MDAtXFxcXHgwOVxcXFx4MEJcXFxceDBDXFxcXHgwRS1cXFxceDFGXFxcXHg3RicgOiAnXFxcXHgwMC1cXFxceDFGXFxcXHg3Ric7XG4gICAgICAgIHJldHVybiB2YWxpZGF0b3IuYmxhY2tsaXN0KHN0ciwgY2hhcnMpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3Iud2hpdGVsaXN0ID0gZnVuY3Rpb24gKHN0ciwgY2hhcnMpIHtcbiAgICAgICAgcmV0dXJuIHN0ci5yZXBsYWNlKG5ldyBSZWdFeHAoJ1teJyArIGNoYXJzICsgJ10rJywgJ2cnKSwgJycpO1xuICAgIH07XG5cbiAgICB2YWxpZGF0b3IuYmxhY2tsaXN0ID0gZnVuY3Rpb24gKHN0ciwgY2hhcnMpIHtcbiAgICAgICAgcmV0dXJuIHN0ci5yZXBsYWNlKG5ldyBSZWdFeHAoJ1snICsgY2hhcnMgKyAnXSsnLCAnZycpLCAnJyk7XG4gICAgfTtcblxuICAgIHZhciBkZWZhdWx0X25vcm1hbGl6ZV9lbWFpbF9vcHRpb25zID0ge1xuICAgICAgICBsb3dlcmNhc2U6IHRydWVcbiAgICB9O1xuXG4gICAgdmFsaWRhdG9yLm5vcm1hbGl6ZUVtYWlsID0gZnVuY3Rpb24gKGVtYWlsLCBvcHRpb25zKSB7XG4gICAgICAgIG9wdGlvbnMgPSBtZXJnZShvcHRpb25zLCBkZWZhdWx0X25vcm1hbGl6ZV9lbWFpbF9vcHRpb25zKTtcbiAgICAgICAgaWYgKCF2YWxpZGF0b3IuaXNFbWFpbChlbWFpbCkpIHtcbiAgICAgICAgICAgIHJldHVybiBmYWxzZTtcbiAgICAgICAgfVxuICAgICAgICB2YXIgcGFydHMgPSBlbWFpbC5zcGxpdCgnQCcsIDIpO1xuICAgICAgICBwYXJ0c1sxXSA9IHBhcnRzWzFdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIGlmIChwYXJ0c1sxXSA9PT0gJ2dtYWlsLmNvbScgfHwgcGFydHNbMV0gPT09ICdnb29nbGVtYWlsLmNvbScpIHtcbiAgICAgICAgICAgIHBhcnRzWzBdID0gcGFydHNbMF0udG9Mb3dlckNhc2UoKS5yZXBsYWNlKC9cXC4vZywgJycpO1xuICAgICAgICAgICAgaWYgKHBhcnRzWzBdWzBdID09PSAnKycpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgICAgICBwYXJ0c1swXSA9IHBhcnRzWzBdLnNwbGl0KCcrJylbMF07XG4gICAgICAgICAgICBwYXJ0c1sxXSA9ICdnbWFpbC5jb20nO1xuICAgICAgICB9IGVsc2UgaWYgKG9wdGlvbnMubG93ZXJjYXNlKSB7XG4gICAgICAgICAgICBwYXJ0c1swXSA9IHBhcnRzWzBdLnRvTG93ZXJDYXNlKCk7XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHBhcnRzLmpvaW4oJ0AnKTtcbiAgICB9O1xuXG4gICAgZnVuY3Rpb24gbWVyZ2Uob2JqLCBkZWZhdWx0cykge1xuICAgICAgICBvYmogPSBvYmogfHwge307XG4gICAgICAgIGZvciAodmFyIGtleSBpbiBkZWZhdWx0cykge1xuICAgICAgICAgICAgaWYgKHR5cGVvZiBvYmpba2V5XSA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICAgICAgICAgICAgICBvYmpba2V5XSA9IGRlZmF1bHRzW2tleV07XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG9iajtcbiAgICB9XG5cbiAgICBmdW5jdGlvbiBjdXJyZW5jeVJlZ2V4KG9wdGlvbnMpIHtcbiAgICAgICAgdmFyIHN5bWJvbCA9ICcoXFxcXCcgKyBvcHRpb25zLnN5bWJvbC5yZXBsYWNlKC9cXC4vZywgJ1xcXFwuJykgKyAnKScgKyAob3B0aW9ucy5yZXF1aXJlX3N5bWJvbCA/ICcnIDogJz8nKVxuICAgICAgICAgICAgLCBuZWdhdGl2ZSA9ICctPydcbiAgICAgICAgICAgICwgd2hvbGVfZG9sbGFyX2Ftb3VudF93aXRob3V0X3NlcCA9ICdbMS05XVxcXFxkKidcbiAgICAgICAgICAgICwgd2hvbGVfZG9sbGFyX2Ftb3VudF93aXRoX3NlcCA9ICdbMS05XVxcXFxkezAsMn0oXFxcXCcgKyBvcHRpb25zLnRob3VzYW5kc19zZXBhcmF0b3IgKyAnXFxcXGR7M30pKidcbiAgICAgICAgICAgICwgdmFsaWRfd2hvbGVfZG9sbGFyX2Ftb3VudHMgPSBbJzAnLCB3aG9sZV9kb2xsYXJfYW1vdW50X3dpdGhvdXRfc2VwLCB3aG9sZV9kb2xsYXJfYW1vdW50X3dpdGhfc2VwXVxuICAgICAgICAgICAgLCB3aG9sZV9kb2xsYXJfYW1vdW50ID0gJygnICsgdmFsaWRfd2hvbGVfZG9sbGFyX2Ftb3VudHMuam9pbignfCcpICsgJyk/J1xuICAgICAgICAgICAgLCBkZWNpbWFsX2Ftb3VudCA9ICcoXFxcXCcgKyBvcHRpb25zLmRlY2ltYWxfc2VwYXJhdG9yICsgJ1xcXFxkezJ9KT8nO1xuICAgICAgICB2YXIgcGF0dGVybiA9IHdob2xlX2RvbGxhcl9hbW91bnQgKyBkZWNpbWFsX2Ftb3VudDtcbiAgICAgICAgLy8gZGVmYXVsdCBpcyBuZWdhdGl2ZSBzaWduIGJlZm9yZSBzeW1ib2wsIGJ1dCB0aGVyZSBhcmUgdHdvIG90aGVyIG9wdGlvbnMgKGJlc2lkZXMgcGFyZW5zKVxuICAgICAgICBpZiAob3B0aW9ucy5hbGxvd19uZWdhdGl2ZXMgJiYgIW9wdGlvbnMucGFyZW5zX2Zvcl9uZWdhdGl2ZXMpIHtcbiAgICAgICAgICAgIGlmIChvcHRpb25zLm5lZ2F0aXZlX3NpZ25fYWZ0ZXJfZGlnaXRzKSB7XG4gICAgICAgICAgICAgICAgcGF0dGVybiArPSBuZWdhdGl2ZTtcbiAgICAgICAgICAgIH1cbiAgICAgICAgICAgIGVsc2UgaWYgKG9wdGlvbnMubmVnYXRpdmVfc2lnbl9iZWZvcmVfZGlnaXRzKSB7XG4gICAgICAgICAgICAgICAgcGF0dGVybiA9IG5lZ2F0aXZlICsgcGF0dGVybjtcbiAgICAgICAgICAgIH1cbiAgICAgICAgfVxuICAgICAgICAvLyBTb3V0aCBBZnJpY2FuIFJhbmQsIGZvciBleGFtcGxlLCB1c2VzIFIgMTIzIChzcGFjZSkgYW5kIFItMTIzIChubyBzcGFjZSlcbiAgICAgICAgaWYgKG9wdGlvbnMuYWxsb3dfbmVnYXRpdmVfc2lnbl9wbGFjZWhvbGRlcikge1xuICAgICAgICAgICAgcGF0dGVybiA9ICcoICg/IVxcXFwtKSk/JyArIHBhdHRlcm47XG4gICAgICAgIH1cbiAgICAgICAgZWxzZSBpZiAob3B0aW9ucy5hbGxvd19zcGFjZV9hZnRlcl9zeW1ib2wpIHtcbiAgICAgICAgICAgIHBhdHRlcm4gPSAnID8nICsgcGF0dGVybjtcbiAgICAgICAgfVxuICAgICAgICBlbHNlIGlmIChvcHRpb25zLmFsbG93X3NwYWNlX2FmdGVyX2RpZ2l0cykge1xuICAgICAgICAgICAgcGF0dGVybiArPSAnKCAoPyEkKSk/JztcbiAgICAgICAgfVxuICAgICAgICBpZiAob3B0aW9ucy5zeW1ib2xfYWZ0ZXJfZGlnaXRzKSB7XG4gICAgICAgICAgICBwYXR0ZXJuICs9IHN5bWJvbDtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICAgIHBhdHRlcm4gPSBzeW1ib2wgKyBwYXR0ZXJuO1xuICAgICAgICB9XG4gICAgICAgIGlmIChvcHRpb25zLmFsbG93X25lZ2F0aXZlcykge1xuICAgICAgICAgICAgaWYgKG9wdGlvbnMucGFyZW5zX2Zvcl9uZWdhdGl2ZXMpIHtcbiAgICAgICAgICAgICAgICBwYXR0ZXJuID0gJyhcXFxcKCcgKyBwYXR0ZXJuICsgJ1xcXFwpfCcgKyBwYXR0ZXJuICsgJyknO1xuICAgICAgICAgICAgfVxuICAgICAgICAgICAgZWxzZSBpZiAoIShvcHRpb25zLm5lZ2F0aXZlX3NpZ25fYmVmb3JlX2RpZ2l0cyB8fCBvcHRpb25zLm5lZ2F0aXZlX3NpZ25fYWZ0ZXJfZGlnaXRzKSkge1xuICAgICAgICAgICAgICAgIHBhdHRlcm4gPSBuZWdhdGl2ZSArIHBhdHRlcm47XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIG5ldyBSZWdFeHAoXG4gICAgICAgICAgICAnXicgK1xuICAgICAgICAgICAgLy8gZW5zdXJlIHRoZXJlJ3MgYSBkb2xsYXIgYW5kL29yIGRlY2ltYWwgYW1vdW50LCBhbmQgdGhhdCBpdCBkb2Vzbid0IHN0YXJ0IHdpdGggYSBzcGFjZSBvciBhIG5lZ2F0aXZlIHNpZ24gZm9sbG93ZWQgYnkgYSBzcGFjZVxuICAgICAgICAgICAgJyg/IS0/ICkoPz0uKlxcXFxkKScgK1xuICAgICAgICAgICAgcGF0dGVybiArXG4gICAgICAgICAgICAnJCdcbiAgICAgICAgKTtcbiAgICB9XG5cbiAgICB2YWxpZGF0b3IuaW5pdCgpO1xuXG4gICAgcmV0dXJuIHZhbGlkYXRvcjtcblxufSk7XG4iLCIvKipcbiAqIE1vZHVsZSBkZXBlbmRlbmNpZXMuXG4gKi9cblxudmFyIHNsaWNlID0gcmVxdWlyZSgnc2xpY2VkJylcbnZhciBmbGF0dGVuID0gcmVxdWlyZSgnYXJyYXktZmxhdHRlbicpXG5cbi8qKlxuICogVGhpcyBmdW5jdGlvbiBsZXRzIHVzIGNyZWF0ZSB2aXJ0dWFsIG5vZGVzIHVzaW5nIGEgc2ltcGxlXG4gKiBzeW50YXguIEl0IGlzIGNvbXBhdGlibGUgd2l0aCBKU1ggdHJhbnNmb3JtcyBzbyB5b3UgY2FuIHVzZVxuICogSlNYIHRvIHdyaXRlIG5vZGVzIHRoYXQgd2lsbCBjb21waWxlIHRvIHRoaXMgZnVuY3Rpb24uXG4gKlxuICogbGV0IG5vZGUgPSBlbGVtZW50KCdkaXYnLCB7IGlkOiAnZm9vJyB9LCBbXG4gKiAgIGVsZW1lbnQoJ2EnLCB7IGhyZWY6ICdodHRwOi8vZ29vZ2xlLmNvbScgfSwgJ0dvb2dsZScpXG4gKiBdKVxuICpcbiAqIFlvdSBjYW4gbGVhdmUgb3V0IHRoZSBhdHRyaWJ1dGVzIG9yIHRoZSBjaGlsZHJlbiBpZiBlaXRoZXJcbiAqIG9mIHRoZW0gYXJlbid0IG5lZWRlZCBhbmQgaXQgd2lsbCBmaWd1cmUgb3V0IHdoYXQgeW91J3JlXG4gKiB0cnlpbmcgdG8gZG8uXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBlbGVtZW50XG5cbi8qKlxuICogQ3JlYXRlIHZpcnR1YWwgdHJlZXMgb2YgY29tcG9uZW50cy5cbiAqXG4gKiBUaGlzIGNyZWF0ZXMgdGhlIG5pY2VyIEFQSSBmb3IgdGhlIHVzZXIuXG4gKiBJdCB0cmFuc2xhdGVzIHRoYXQgZnJpZW5kbHkgQVBJIGludG8gYW4gYWN0dWFsIHRyZWUgb2Ygbm9kZXMuXG4gKlxuICogQHBhcmFtIHsqfSB0eXBlXG4gKiBAcGFyYW0ge09iamVjdH0gYXR0cmlidXRlc1xuICogQHBhcmFtIHtBcnJheX0gY2hpbGRyZW5cbiAqIEByZXR1cm4ge09iamVjdH1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuZnVuY3Rpb24gZWxlbWVudCAodHlwZSwgYXR0cmlidXRlcywgY2hpbGRyZW4pIHtcbiAgLy8gRGVmYXVsdCB0byBkaXYgd2l0aCBubyBhcmdzXG4gIGlmICghdHlwZSkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ2VsZW1lbnQoKSBuZWVkcyBhIHR5cGUuJylcbiAgfVxuXG4gIC8vIFNraXBwZWQgYWRkaW5nIGF0dHJpYnV0ZXMgYW5kIHdlJ3JlIHBhc3NpbmdcbiAgLy8gaW4gY2hpbGRyZW4gaW5zdGVhZC5cbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPT09IDIgJiYgKHR5cGVvZiBhdHRyaWJ1dGVzID09PSAnc3RyaW5nJyB8fCBBcnJheS5pc0FycmF5KGF0dHJpYnV0ZXMpKSkge1xuICAgIGNoaWxkcmVuID0gWyBhdHRyaWJ1dGVzIF1cbiAgICBhdHRyaWJ1dGVzID0ge31cbiAgfVxuXG4gIC8vIEFjY291bnQgZm9yIEpTWCBwdXR0aW5nIHRoZSBjaGlsZHJlbiBhcyBtdWx0aXBsZSBhcmd1bWVudHMuXG4gIC8vIFRoaXMgaXMgZXNzZW50aWFsbHkganVzdCB0aGUgRVM2IHJlc3QgcGFyYW1cbiAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAyKSB7XG4gICAgY2hpbGRyZW4gPSBzbGljZShhcmd1bWVudHMsIDIpXG4gIH1cblxuICBjaGlsZHJlbiA9IGNoaWxkcmVuIHx8IFtdXG4gIGF0dHJpYnV0ZXMgPSBhdHRyaWJ1dGVzIHx8IHt9XG5cbiAgLy8gRmxhdHRlbiBuZXN0ZWQgY2hpbGQgYXJyYXlzLiBUaGlzIGlzIGhvdyBKU1ggY29tcGlsZXMgc29tZSBub2Rlcy5cbiAgY2hpbGRyZW4gPSBmbGF0dGVuKGNoaWxkcmVuLCAyKVxuXG4gIC8vIEZpbHRlciBvdXQgYW55IGB1bmRlZmluZWRgIGVsZW1lbnRzXG4gIGNoaWxkcmVuID0gY2hpbGRyZW4uZmlsdGVyKGZ1bmN0aW9uIChpKSB7IHJldHVybiB0eXBlb2YgaSAhPT0gJ3VuZGVmaW5lZCcgfSlcblxuICAvLyBpZiB5b3UgcGFzcyBpbiBhIGZ1bmN0aW9uLCBpdCdzIGEgYENvbXBvbmVudGAgY29uc3RydWN0b3IuXG4gIC8vIG90aGVyd2lzZSBpdCdzIGFuIGVsZW1lbnQuXG4gIHJldHVybiB7XG4gICAgdHlwZTogdHlwZSxcbiAgICBjaGlsZHJlbjogY2hpbGRyZW4sXG4gICAgYXR0cmlidXRlczogYXR0cmlidXRlc1xuICB9XG59XG4iLCIndXNlIHN0cmljdCdcblxuLyoqXG4gKiBFeHBvc2UgYGFycmF5RmxhdHRlbmAuXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gYXJyYXlGbGF0dGVuXG5cbi8qKlxuICogUmVjdXJzaXZlIGZsYXR0ZW4gZnVuY3Rpb24gd2l0aCBkZXB0aC5cbiAqXG4gKiBAcGFyYW0gIHtBcnJheX0gIGFycmF5XG4gKiBAcGFyYW0gIHtBcnJheX0gIHJlc3VsdFxuICogQHBhcmFtICB7TnVtYmVyfSBkZXB0aFxuICogQHJldHVybiB7QXJyYXl9XG4gKi9cbmZ1bmN0aW9uIGZsYXR0ZW5XaXRoRGVwdGggKGFycmF5LCByZXN1bHQsIGRlcHRoKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYXJyYXkubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmFsdWUgPSBhcnJheVtpXVxuXG4gICAgaWYgKGRlcHRoID4gMCAmJiBBcnJheS5pc0FycmF5KHZhbHVlKSkge1xuICAgICAgZmxhdHRlbldpdGhEZXB0aCh2YWx1ZSwgcmVzdWx0LCBkZXB0aCAtIDEpXG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdC5wdXNoKHZhbHVlKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXN1bHRcbn1cblxuLyoqXG4gKiBSZWN1cnNpdmUgZmxhdHRlbiBmdW5jdGlvbi4gT21pdHRpbmcgZGVwdGggaXMgc2xpZ2h0bHkgZmFzdGVyLlxuICpcbiAqIEBwYXJhbSAge0FycmF5fSBhcnJheVxuICogQHBhcmFtICB7QXJyYXl9IHJlc3VsdFxuICogQHJldHVybiB7QXJyYXl9XG4gKi9cbmZ1bmN0aW9uIGZsYXR0ZW5Gb3JldmVyIChhcnJheSwgcmVzdWx0KSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYXJyYXkubGVuZ3RoOyBpKyspIHtcbiAgICB2YXIgdmFsdWUgPSBhcnJheVtpXVxuXG4gICAgaWYgKEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBmbGF0dGVuRm9yZXZlcih2YWx1ZSwgcmVzdWx0KVxuICAgIH0gZWxzZSB7XG4gICAgICByZXN1bHQucHVzaCh2YWx1ZSlcbiAgICB9XG4gIH1cblxuICByZXR1cm4gcmVzdWx0XG59XG5cbi8qKlxuICogRmxhdHRlbiBhbiBhcnJheSwgd2l0aCB0aGUgYWJpbGl0eSB0byBkZWZpbmUgYSBkZXB0aC5cbiAqXG4gKiBAcGFyYW0gIHtBcnJheX0gIGFycmF5XG4gKiBAcGFyYW0gIHtOdW1iZXJ9IGRlcHRoXG4gKiBAcmV0dXJuIHtBcnJheX1cbiAqL1xuZnVuY3Rpb24gYXJyYXlGbGF0dGVuIChhcnJheSwgZGVwdGgpIHtcbiAgaWYgKGRlcHRoID09IG51bGwpIHtcbiAgICByZXR1cm4gZmxhdHRlbkZvcmV2ZXIoYXJyYXksIFtdKVxuICB9XG5cbiAgcmV0dXJuIGZsYXR0ZW5XaXRoRGVwdGgoYXJyYXksIFtdLCBkZXB0aClcbn1cbiIsIm1vZHVsZS5leHBvcnRzID0gZXhwb3J0cyA9IHJlcXVpcmUoJy4vbGliL3NsaWNlZCcpO1xuIiwiXG4vKipcbiAqIEFuIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cykgYWx0ZXJuYXRpdmVcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gYXJncyBzb21ldGhpbmcgd2l0aCBhIGxlbmd0aFxuICogQHBhcmFtIHtOdW1iZXJ9IHNsaWNlXG4gKiBAcGFyYW0ge051bWJlcn0gc2xpY2VFbmRcbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiAoYXJncywgc2xpY2UsIHNsaWNlRW5kKSB7XG4gIHZhciByZXQgPSBbXTtcbiAgdmFyIGxlbiA9IGFyZ3MubGVuZ3RoO1xuXG4gIGlmICgwID09PSBsZW4pIHJldHVybiByZXQ7XG5cbiAgdmFyIHN0YXJ0ID0gc2xpY2UgPCAwXG4gICAgPyBNYXRoLm1heCgwLCBzbGljZSArIGxlbilcbiAgICA6IHNsaWNlIHx8IDA7XG5cbiAgaWYgKHNsaWNlRW5kICE9PSB1bmRlZmluZWQpIHtcbiAgICBsZW4gPSBzbGljZUVuZCA8IDBcbiAgICAgID8gc2xpY2VFbmQgKyBsZW5cbiAgICAgIDogc2xpY2VFbmRcbiAgfVxuXG4gIHdoaWxlIChsZW4tLSA+IHN0YXJ0KSB7XG4gICAgcmV0W2xlbiAtIHN0YXJ0XSA9IGFyZ3NbbGVuXTtcbiAgfVxuXG4gIHJldHVybiByZXQ7XG59XG5cbiIsImltcG9ydCB7IEFDVElPTlMgfSBmcm9tICcuL2NvcmUvY29uc3RhbnRzJ1xuaW1wb3J0IERpc3BhdGNoZXIgZnJvbSAnLi9jb3JlL2Rpc3BhdGNoZXInXG5pbXBvcnQgQXBwbGljYXRpb24gZnJvbSAnLi9jb3JlL2FwcGxpY2F0aW9uJ1xuXG5BcHBsaWNhdGlvbi5zdGFydCgpXG4iLCJpbXBvcnQgZWxlbWVudCBmcm9tICd2aXJ0dWFsLWVsZW1lbnQnXG5pbXBvcnQgeyByZW5kZXIsIHRyZWUgfSBmcm9tICdkZWt1J1xuXG5leHBvcnQgZGVmYXVsdCB7XG4gIHJlbmRlcjogKCkgPT5cbiAgICA8ZGl2IGNsYXNzPVwidWkgcG9pbnRpbmcgaW52ZXJ0ZWQgbWVudVwiPiAgICAgIFxuICAgIDwvZGl2PlxufVxuIiwiaW1wb3J0IGVsZW1lbnQgZnJvbSAndmlydHVhbC1lbGVtZW50J1xuaW1wb3J0IHsgcmVuZGVyLCB0cmVlIH0gZnJvbSAnZGVrdSdcblxuZXhwb3J0IGRlZmF1bHQge1xuICByZW5kZXI6ICgpID0+XG4gICA8ZGl2IGNsYXNzPVwidWkgcG9pbnRpbmcgaW52ZXJ0ZWQgbWVudVwiPlxuICAgICAgPGEgY2xhc3M9XCJhY3RpdmUgaXRlbVwiPlxuICAgICAgICAgIDxpIGNsYXNzPVwiaW52ZXJ0ZWQgYmx1ZSBob21lIGljb25cIj48L2k+IERvY3VtZW50c1xuICAgICAgPC9hPlxuICAgICAgPGRpdiBjbGFzcz1cInJpZ2h0IG1lbnVcIj5cbiAgICAgICAgICA8YSBjbGFzcz1cIml0ZW1cIj5cbiAgICAgICAgICAgICAgPGkgY2xhc3M9XCJpbnZlcnRlZCBibHVlIHNldHRpbmdzIGljb25cIj48L2k+IFNldHRpbmdzXG4gICAgICAgICAgPC9hPlxuICAgICAgICAgIDxhIGNsYXNzPVwiaXRlbVwiPlxuICAgICAgICAgICAgICA8aSBjbGFzcz1cImludmVydGVkIGJsdWUgdXNlciBpY29uXCI+PC9pPiBMb2dpblxuICAgICAgICAgIDwvYT5cbiAgICAgIDwvZGl2PlxuICAgIDwvZGl2PlxufVxuIiwiaW1wb3J0IGVsZW1lbnQgZnJvbSAndmlydHVhbC1lbGVtZW50J1xuXG5pbXBvcnQgRG9jdW1lbnRFZGl0b3IgZnJvbSAnLi9kb2N1bWVudC1lZGl0b3InXG5pbXBvcnQgRG9jdW1lbnRMaXN0IGZyb20gJy4vZG9jdW1lbnQtbGlzdCdcblxuZXhwb3J0IGRlZmF1bHQge1xuICByZW5kZXI6ICgpID0+XG4gICAgPHNlY3Rpb24gY2xhc3M9XCJ2aWV3IHVpIGdyaWQgY29udGFpbmVyXCI+XG4gICAgICA8ZGl2IGNsYXNzPVwiZm91ciB3aWRlIGNvbHVtblwiPlxuICAgICAgICA8RG9jdW1lbnRMaXN0IHRpdGxlPVwiZG9jdW1lbnRzXCIgLz5cbiAgICAgIDwvZGl2PlxuICAgICAgPGRpdiBjbGFzcz1cInR3ZWx2ZSB3aWRlIGNvbHVtblwiPlxuICAgICAgICA8RG9jdW1lbnRFZGl0b3IgLz5cbiAgICAgIDwvZGl2PlxuICAgIDwvc2VjdGlvbj5cbn1cbiIsImltcG9ydCBlbGVtZW50IGZyb20gJ3ZpcnR1YWwtZWxlbWVudCdcbmltcG9ydCB7QUNUSU9OU30gZnJvbSAnLi4vY29yZS9jb25zdGFudHMnO1xuaW1wb3J0IERpc3BhdGNoZXIgZnJvbSAnLi4vY29yZS9kaXNwYXRjaGVyJztcbmltcG9ydCBEb2N1bWVudFN0b3JlIGZyb20gJy4uL3N0b3Jlcy9kb2N1bWVudCdcblxuXG5sZXQgRG9jdW1lbnRFZGl0b3IgPSB7XG4gIGluaXRpYWxTdGF0ZShwcm9wcykge1xuICAgIHJldHVybiB7XG4gICAgICBsb2FkZWQ6IGZhbHNlLFxuICAgICAgYm9keTogXCJJIGhhdmUgZG9jdW1lbnQgcG93ZXJzIVwiLFxuICAgIH1cbiAgfSxcblxuICBhc3luYyBhZnRlck1vdW50KGMsIGVsLCBzZXRTdGF0ZSkge1xuICAgIC8vIGRvY3VtZW50IHNlbGVjdGVkIGxpc3RlbmVyXG5cbiAgICBsZXQgZWRpdG9yID0gbmV3IEVwaWNFZGl0b3Ioe1xuICAgICAgYmFzZVBhdGg6ICdlcGljZWRpdG9yJyxcbiAgICAgIGF1dG9ncm93OiB0cnVlXG4gICAgfSlcbiAgICBlZGl0b3IubG9hZCgpXG4gICAgZWRpdG9yLm9uKFwidXBkYXRlXCIsICgpID0+IHtcbiAgICAgIC8vIERvY3VtZW50U3RvcmUuc2F2ZSgpXG4gICAgfSlcbiAgICBEaXNwYXRjaGVyLnJlZ2lzdGVyKGFjdGlvbiA9PiB7XG4gICAgICBpZiAoYWN0aW9uLmFjdGlvblR5cGUgPT0gQUNUSU9OUy5TRUxFQ1RfRE9DVU1FTlQpIHtcbiAgICAgICAgZWRpdG9yLmdldEVsZW1lbnQoJ2VkaXRvcicpLmJvZHkuaW5uZXJIVE1MID0gRG9jdW1lbnRTdG9yZS5nZXRTdGF0ZSgpW2FjdGlvbi5pZF0uYm9keVxuICAgICAgfVxuICAgIH0pXG5cbiAgICBzZXRTdGF0ZSh7IGxvYWRlZDogdHJ1ZSB9KVxuICB9LFxuXG4gIHJlbmRlcih7IHByb3BzLCBzdGF0ZSB9LCBzZXRTdGF0ZSkge1xuICAgIHJldHVybiA8ZGl2IGlkPVwiZXBpY2VkaXRvclwiPjwvZGl2PlxuICB9XG59XG5leHBvcnQgZGVmYXVsdCBEb2N1bWVudEVkaXRvclxuIiwiaW1wb3J0IGVsZW1lbnQgZnJvbSAndmlydHVhbC1lbGVtZW50J1xuXG5pbXBvcnQge0FDVElPTlN9IGZyb20gJy4uL2NvcmUvY29uc3RhbnRzJztcbmltcG9ydCBEaXNwYXRjaGVyIGZyb20gJy4uL2NvcmUvZGlzcGF0Y2hlcic7XG5pbXBvcnQgRG9jdW1lbnRTdG9yZSBmcm9tICcuLi9zdG9yZXMvZG9jdW1lbnQnXG5cbmxldCBMb2FkZXIgPSB7XG4gIHJlbmRlcih7cHJvcHN9KSB7XG4gICAgcmV0dXJuIDxkaXYgY2xhc3M9e2B1aSAke3Byb3BzLmFjdGl2ZSA/IFwiYWN0aXZlXCIgOiBcIlwifSBkaW1tZXJgfT5cbiAgICAgIDxkaXYgY2xhc3M9XCJ1aSB0ZXh0IGxvYWRlclwiPkxvYWRpbmc8L2Rpdj5cbiAgICA8L2Rpdj5cbiAgfVxufVxuXG5sZXQgRG9jdW1lbnRJdGVtID0ge1xuICByZW5kZXI6IGMgPT4ge1xuICAgIGxldCBfaXRlbSA9IGMucHJvcHMuaXRlbVxuICAgIGxldCBzZWxlY3QgPSAoKSA9PiBEaXNwYXRjaGVyLmRpc3BhdGNoKHtcbiAgICAgIGFjdGlvblR5cGU6IEFDVElPTlMuU0VMRUNUX0RPQ1VNRU5ULFxuICAgICAgaWQ6IF9pdGVtLmlkXG4gICAgfSlcbiAgICBsZXQgV3JhcCA9IHtcbiAgICAgIHJlbmRlciAoe3Byb3BzfSkge1xuICAgICAgICBpZiAoYy5wcm9wcy5hY3RpdmUpXG4gICAgICAgICAgcmV0dXJuIDxkaXYgY2xhc3M9XCJhY3RpdmUgaXRlbVwiPntwcm9wcy5jaGlsZHJlbn08L2Rpdj5cbiAgICAgICAgcmV0dXJuIDxhIGNsYXNzPVwiaXRlbVwiIG9uQ2xpY2s9e3NlbGVjdH0+e3Byb3BzLmNoaWxkcmVufTwvYT5cbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gPFdyYXA+e19pdGVtLm5hbWV9PC9XcmFwPlxuICB9XG59XG5cbmxldCBpbml0aWFsU3RhdGUgPSAocHJvcHMpID0+ICh7XG4gIGxvYWRpbmc6IHRydWUsXG4gIHNlbGVjdGVkOiBudWxsLFxuICBpdGVtczogRG9jdW1lbnRTdG9yZS5nZXRTdGF0ZSgpLFxuICBhZGRpbmc6IGZhbHNlXG59KVxuXG5mdW5jdGlvbiB1cGRhdGVJdGVtcyhzZXRTdGF0ZSkge1xuICByZXR1cm4gKCkgPT4gc2V0U3RhdGUoe1xuICAgIGxvYWRpbmc6IGZhbHNlLFxuICAgIGl0ZW1zOiBEb2N1bWVudFN0b3JlLmdldFN0YXRlKClcbiAgfSlcbn1cblxubGV0IGFmdGVyTW91bnQgPSAoYywgZWwsIHNldFN0YXRlKSA9PiB7XG4gIC8vIGRvY3VtZW50IHN5bmMgbGlzdGVuZXJcbiAgbGV0IG9uU3luYyA9IHVwZGF0ZUl0ZW1zKHNldFN0YXRlKVxuICBEb2N1bWVudFN0b3JlLm9uKCdzeW5jOnN1Y2Nlc3MnLCBvblN5bmMpXG4gIHNldFN0YXRlKHsgb25TeW5jIH0pXG5cbiAgLy8gZG9jdW1lbnQgc2VsZWN0ZWQgbGlzdGVuZXJcbiAgRGlzcGF0Y2hlci5yZWdpc3RlcihhY3Rpb24gPT4ge1xuICAgIGlmIChhY3Rpb24uYWN0aW9uVHlwZSA9PSBBQ1RJT05TLlNFTEVDVF9ET0NVTUVOVCkge1xuICAgICAgc2V0U3RhdGUoe1xuICAgICAgICBzZWxlY3RlZDogYWN0aW9uLmlkXG4gICAgICB9KVxuICAgIH1cbiAgfSlcbn1cblxubGV0IGJlZm9yZVVubW91bnQgPSAoYykgPT4ge1xuICBEb2N1bWVudFN0b3JlLnJlbW92ZUxpc3RlbmVyKCdzeW5jOnN1Y2Nlc3MnLCBjLnN0YXRlLm9uU3luYylcbn1cblxubGV0IHJlbmRlciA9ICh7IHByb3BzLCBzdGF0ZSB9LCBzZXRTdGF0ZSkgPT4ge1xuICBsZXQgeyBpdGVtcz1bXSB9ID0gc3RhdGVcblxuICBsZXQgYWRkID0gKCkgPT4ge1xuICAgIERpc3BhdGNoZXIuZGlzcGF0Y2goe1xuICAgICAgYWN0aW9uVHlwZSA6IEFDVElPTlMuQ1JFQVRFX0RPQ1VNRU5ULFxuICAgIH0pO1xuICB9XG5cbiAgbGV0IGxpc3QgPSBpdGVtcy5tYXAoaXRlbSA9PiA8RG9jdW1lbnRJdGVtIGFjdGl2ZT17aXRlbS5pZCA9PT0gc3RhdGUuc2VsZWN0ZWR9IGl0ZW09e2l0ZW19IG9uQ2xpY2s9XCJmYWxzZVwiIC8+KVxuXG4gIHJldHVybiA8ZGl2IGNsYXNzPVwidWkgbGluayBsaXN0XCI+XG4gICAgPExvYWRlciBhY3RpdmU9e3N0YXRlLmxvYWRpbmd9PkxvYWRpbmc8L0xvYWRlcj5cbiAgICAgIHtcbiAgICAgICAgc3RhdGUuYWRkaW5nXG4gICAgICAgID9cbiAgICAgICAgICA8ZGl2PlxuICAgICAgICAgICAgPGlucHV0IHR5cGU9XCJ0ZXh0XCIgY2xhc3M9XCJ1aSB0aW55IGJhc2ljIGlucHV0XCIgb25DaGFuZ2U9eyBlID0+IHNldFN0YXRlKHsgYWRkaW5nOiBlLnRhcmdldC52YWx1ZSB9KSB9IC8+XG4gICAgICAgICAgICA8ZGl2IGNsYXNzPVwidWkgdGlueSBiYXNpYyBidXR0b25cIiBvbkNsaWNrPXthZGR9PlxuICAgICAgICAgICAgICA8aSBjbGFzcz1cImljb24gYWRkXCI+PC9pPlxuICAgICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgIDpcbiAgICAgICAgICA8ZGl2IGNsYXNzPVwidWkgYmFzaWMgYnV0dG9uXCIgb25DbGljaz17KCkgPT4gc2V0U3RhdGUoeyBhZGRpbmc6ICcnIH0pfT5cbiAgICAgICAgICAgIE5ld1xuICAgICAgICAgIDwvZGl2PlxuICAgICAgfVxuICAgIHtsaXN0fVxuXG4gIDwvZGl2PlxufVxubGV0IERvY3VtZW50TGlzdCA9IHtcbiAgaW5pdGlhbFN0YXRlLFxuICBhZnRlck1vdW50LFxuICBiZWZvcmVVbm1vdW50LFxuICByZW5kZXIsXG59XG5leHBvcnQgZGVmYXVsdCBEb2N1bWVudExpc3RcbiIsImltcG9ydCBlbGVtZW50IGZyb20gJ3ZpcnR1YWwtZWxlbWVudCdcblxubGV0IGdoc3R5bGUgPSBgXG4gIHBvc2l0aW9uOiBhYnNvbHV0ZTtcbiAgdG9wOiAwcHg7XG4gIGxlZnQ6IDBweDtcbmBcbmxldCBnaGZvcmtzcmMgPSBcImh0dHBzOi8vY2Ftby5naXRodWJ1c2VyY29udGVudC5jb20vYzYyODZhZGU3MTVlOWJlYTQzM2I0NzA1ODcwZGU0ODJhNjU0Zjc4YS82ODc0NzQ3MDczM2EyZjJmNzMzMzJlNjE2ZDYxN2E2ZjZlNjE3NzczMmU2MzZmNmQyZjY3Njk3NDY4NzU2MjJmNzI2OTYyNjI2ZjZlNzMyZjY2NmY3MjZiNmQ2NTVmNmM2NTY2NzQ1Zjc3Njg2OTc0NjU1ZjY2NjY2NjY2NjY2NjJlNzA2ZTY3XCJcbmxldCBjYW5vbmljYWx3dGYgPSBcImh0dHBzOi8vczMuYW1hem9uYXdzLmNvbS9naXRodWIvcmliYm9ucy9mb3JrbWVfbGVmdF93aGl0ZV9mZmZmZmYucG5nXCJcblxubGV0IEZvcmttZSA9IHtcbiAgcmVuZGVyOiAoe3Byb3BzfSkgPT5cbiAgICA8YSBocmVmPXtgaHR0cHM6Ly9naXRodWIuY29tLyR7cHJvcHMucmVwb31gfSBzdHlsZT17Z2hzdHlsZX0gPlxuICAgICAgPGltZyBzcmM9e2doZm9ya3NyY30gYWx0PVwiRm9yayBtZSBvbiBHaXRIdWJcIiBkYXRhLWNhbm9uaWNhbC1zcmM9e2Nhbm9uaWNhbHd0Zn0gLz5cbiAgICA8L2E+XG59XG5leHBvcnQgZGVmYXVsdCBGb3JrbWVcbiIsImltcG9ydCB7IHJlbmRlciwgdHJlZSB9IGZyb20gJ2Rla3UnXG5pbXBvcnQgZWxlbWVudCBmcm9tICd2aXJ0dWFsLWVsZW1lbnQnXG5cbmltcG9ydCBGb3JrbWUgZnJvbSAnLi9mb3JrbWUnXG5pbXBvcnQgSGVhZGVyIGZyb20gJy4vYXBwLWhlYWRlcidcbmltcG9ydCBBcHBWaWV3IGZyb20gJy4vYXBwLXZpZXcnXG5pbXBvcnQgRm9vdGVyIGZyb20gJy4vYXBwLWZvb3RlcidcblxuaW1wb3J0IHsgQUNUSU9OUyB9IGZyb20gJy4uL2NvcmUvY29uc3RhbnRzJ1xuaW1wb3J0IERpc3BhdGNoZXIgZnJvbSAnLi4vY29yZS9kaXNwYXRjaGVyJ1xuXG5sZXQgTGF5b3V0ID0ge1xuICBpbml0aWFsU3RhdGU6ICgpID0+ICh7XG4gICAgdmlldzogQXBwVmlld1xuICB9KSxcbiAgYWZ0ZXJNb3VudDogKGMsIGVsLCB1cGRhdGUpID0+IHtcbiAgICBsZXQgb25OYXZpZ2F0ZSA9IGRhdGEgPT4ge1xuICAgICAgZGF0YS5hY3Rpb25UeXBlICE9IEFDVElPTlMuTkFWSUdBVEUgfHwgdXBkYXRlKHsndmlldyc6IGRhdGEudmlld30pXG4gICAgfVxuXG4gICAgRGlzcGF0Y2hlci5yZWdpc3Rlciggb25OYXZpZ2F0ZSApXG4gIH0sXG4gIHJlbmRlcjogYyA9PiB7XG4gICAgbGV0IFZpZXcgPSBjLnN0YXRlLnZpZXdcbiAgICByZXR1cm4gPG1haW4gY2xhc3M9XCJ1aSBsYXlvdXQgY29udGFpbmVyXCI+XG4gICAgICA8Rm9ya21lIHJlcG89XCJkczBudC9tZHBhZFwiIC8+XG4gICAgICA8SGVhZGVyIC8+XG4gICAgICA8VmlldyAvPlxuICAgICAgPEZvb3RlciAvPlxuICAgIDwvbWFpbj5cbiAgfVxufVxuXG5sZXQgaW5pdCA9ICgpID0+IHtcbiAgcmVuZGVyKHRyZWUoPExheW91dCAvPiksIGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdhcHAnKSlcbn1cblxuZXhwb3J0IGRlZmF1bHQge1xuICBMYXlvdXQsXG4gIGluaXRcbn1cbiIsImltcG9ydCBlbGVtZW50IGZyb20gJ3ZpcnR1YWwtZWxlbWVudCdcbmltcG9ydCBBdXRoU3RvcmUgZnJvbSAnLi4vc3RvcmVzL2F1dGgnXG5pbXBvcnQgRGlzcGF0Y2hlciBmcm9tICcuLi9jb3JlL2Rpc3BhdGNoZXInXG5pbXBvcnQgeyBBQ1RJT05TIH0gZnJvbSAnLi4vY29yZS9jb25zdGFudHMnXG5mdW5jdGlvbiBjcmVhdGVGaWVsZEhhbmRsZXIoIG5hbWUgKSB7XG4gIHJldHVybiAoZSwgYywgc2V0U3RhdGUpID0+IHtcbiAgICBsZXQgdXBkYXRlID0ge31cbiAgICB1cGRhdGVbIG5hbWUgXSA9IGUudGFyZ2V0LnZhbHVlXG4gICAgc2V0U3RhdGUoIHVwZGF0ZSApXG4gIH1cbn1cblxuZnVuY3Rpb24gaGFuZGxlU3VibWl0KCBlLCBjb21wb25lbnQsIHNldFN0YXRlICkge1xuICBlLnByZXZlbnREZWZhdWx0KClcbiAgc2V0U3RhdGUoeyBzdWJtaXR0aW5nOiB0cnVlIH0pXG4gIERpc3BhdGNoZXIuZGlzcGF0Y2goe1xuICAgIGFjdGlvblR5cGUgOiBBQ1RJT05TLkxPR0lOLFxuICAgIHVzZXJuYW1lICAgOiBjb21wb25lbnQuc3RhdGUudXNlcm5hbWUsXG4gICAgcGFzc3dvcmQgICA6IGNvbXBvbmVudC5zdGF0ZS5wYXNzd29yZFxuICB9KVxufVxuXG5sZXQgaW5pdGlhbFN0YXRlID0gKCkgPT4ge1xuICByZXR1cm4ge1xuICAgIHVzZXJuYW1lICAgOiAnJyxcbiAgICBwYXNzd29yZCAgIDogJycsXG4gICAgc3VibWl0dGluZyA6IGZhbHNlLFxuICAgIGVycm9yICAgICAgOiAnJ1xuICB9XG59XG5sZXQgYWZ0ZXJNb3VudCA9IChjLCBlbCwgc2V0U3RhdGUpID0+IHtcbiAgbGV0IGZuID0gZXJyb3IgPT4gc2V0U3RhdGUoe1xuICAgIHN1Ym1pdHRpbmcgOiBmYWxzZSxcbiAgICBlcnJvciAgICAgIDogZXJyb3JcbiAgfSlcbiAgQXV0aFN0b3JlLm9uKCdsb2dpbjpmYWlsdXJlJywgZm4pXG4gIHNldFN0YXRlKHsgbG9naW5IYW5kbGVyOiBmbiB9KVxufVxuXG5sZXQgYmVmb3JlVW5tb3VudCA9IChjKSA9PiB7XG4gIEF1dGhTdG9yZS5yZW1vdmVMaXN0ZW5lcignbG9naW46ZmFpbHVyZScsIGMuc3RhdGUubG9naW5IYW5kbGVyKVxufVxuXG5sZXQgcmVuZGVyID0gYyA9PiB7XG4gIGxldCB7IHN0YXRlLCBwcm9wcyB9ID0gY1xuICBsZXQgYnV0dG9uQ29udGVudCA9ICdMb2dpbidcbiAgaWYgKCBzdGF0ZS5zdWJtaXR0aW5nICkge1xuICAgIGJ1dHRvbkNvbnRlbnQgPSAoPGltZyBzcmM9XCIvaW1nL2xvYWRpbmcuZ2lmXCIgYWx0PVwiTG9nZ2luZyBpbi4uLlwiIC8+KVxuICB9XG5cbiAgcmV0dXJuIChcbiAgICA8ZGl2IGNsYXNzPVwibG9naW4tcGFnZVwiPlxuICAgICAgPGZvcm0gb25TdWJtaXQ9e2hhbmRsZVN1Ym1pdH0gY2xhc3M9XCJwdXJlLWZvcm1cIj5cbiAgICAgICAgPHAgY2xhc3M9XCJlcnJvclwiPntzdGF0ZS5lcnJvcn08L3A+XG4gICAgICAgIDxpbnB1dCB0eXBlPVwidGV4dFwiIG9uQ2hhbmdlPXtjcmVhdGVGaWVsZEhhbmRsZXIoJ3VzZXJuYW1lJyl9IHZhbHVlPXtzdGF0ZS51c2VybmFtZX0gcGxhY2Vob2xkZXI9XCJVc2VybmFtZVwiIC8+XG4gICAgICAgIDxpbnB1dCB0eXBlPVwicGFzc3dvcmRcIiBvbkNoYW5nZT17Y3JlYXRlRmllbGRIYW5kbGVyKCdwYXNzd29yZCcpfSB2YWx1ZT17c3RhdGUucGFzc3dvcmR9IHBsYWNlaG9sZGVyPVwiUGFzc3dvcmRcIiAvPlxuICAgICAgICA8YnV0dG9uIHR5cGU9XCJzdWJtaXRcIj57YnV0dG9uQ29udGVudH08L2J1dHRvbj5cbiAgICAgIDwvZm9ybT5cbiAgICAgIDxwIGNsYXNzPVwibG9naW4tc2lnbnVwLWxpbmtcIj48YSBocmVmPVwiL3NpZ251cFwiPk5lZWQgYW4gYWNjb3VudD88L2E+PC9wPlxuICAgIDwvZGl2PlxuICApXG59XG5sZXQgTG9naW5WaWV3ID0ge1xuICBpbml0aWFsU3RhdGUsXG4gIGFmdGVyTW91bnQsXG4gIGJlZm9yZVVubW91bnQsXG4gIHJlbmRlcixcbn1cbmV4cG9ydCBkZWZhdWx0IExvZ2luVmlld1xuIiwiaW1wb3J0IHsgUm91dGVyIH0gZnJvbSAnZGlyZWN0b3InXG5pbXBvcnQgQXV0aFN0b3JlIGZyb20gJy4uL3N0b3Jlcy9hdXRoJ1xuaW1wb3J0IExheW91dCBmcm9tICcuLi9jb21wb25lbnRzL2xheW91dCdcbmltcG9ydCB7IEFDVElPTlMgfSBmcm9tICcuLi9jb3JlL2NvbnN0YW50cydcbmltcG9ydCBBcHBWaWV3IGZyb20gJy4uL2NvbXBvbmVudHMvYXBwLXZpZXcnXG5pbXBvcnQgTG9naW5WaWV3IGZyb20gJy4uL2NvbXBvbmVudHMvbG9naW4tdmlldydcbmltcG9ydCBEaXNwYXRjaGVyIGZyb20gJy4uL2NvcmUvZGlzcGF0Y2hlcidcblxuY2xhc3MgQXBwbGljYXRpb24ge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBMYXlvdXQuaW5pdCgpXG4gICAgdGhpcy5yb3V0ZXIgPSBSb3V0ZXIoe1xuICAgICAgJy8nOiBbdGhpcy5hdXRoZWQsIHRoaXMuYXBwXSxcbiAgICAgICcvbG9naW4nOiBbdGhpcy51bmF1dGhlZCwgdGhpcy5sb2dpbl0sXG4gICAgICAnL3NpZ251cCc6IFt0aGlzLnVuYXV0aGVkLCB0aGlzLnNpZ251cF0sXG4gICAgICAnL2xvZ291dCc6IFt0aGlzLmF1dGhlZCwgdGhpcy5sb2dvdXRdLFxuICAgIH0pXG4gICAgdGhpcy5yb3V0ZXIuaW5pdCgpXG4gICAgQXV0aFN0b3JlLm9uKCdsb2dpbjpzdWNjZXNzJywgKCkgPT4gdGhpcy5yb3V0ZXIuc2V0Um91dGUoJy8nKSApXG4gIH1cblxuICBzdGFydCgpIHtcbiAgfVxuXG4gIGF1dGhlZCgpIHtcbiAgICBpZiAoIUF1dGhTdG9yZS5pc0F1dGhlbnRpY2F0ZWQoKSkge1xuICAgICAgdGhpcy5zZXRSb3V0ZSgnL2xvZ2luJylcbiAgICB9XG4gIH1cblxuICB1bmF1dGhlZCgpIHtcbiAgICBpZiAoQXV0aFN0b3JlLmlzQXV0aGVudGljYXRlZCgpKSB7XG4gICAgICB0aGlzLnNldFJvdXRlKCcvJylcbiAgICB9XG4gIH1cblxuICBhcHAoKSB7XG4gICAgRGlzcGF0Y2hlci5kaXNwYXRjaCh7XG4gICAgICBhY3Rpb25UeXBlOiBBQ1RJT05TLlNZTkNfRE9DVU1FTlRTXG4gICAgfSlcbiAgICBEaXNwYXRjaGVyLmRpc3BhdGNoKHtcbiAgICAgIGFjdGlvblR5cGUgOiBBQ1RJT05TLk5BVklHQVRFLFxuICAgICAgdmlldyAgIDogQXBwVmlld1xuICAgIH0pXG4gIH1cblxuICBsb2dpbigpIHtcbiAgICBEaXNwYXRjaGVyLmRpc3BhdGNoKHtcbiAgICAgIGFjdGlvblR5cGUgOiBBQ1RJT05TLk5BVklHQVRFLFxuICAgICAgdmlldyAgIDogTG9naW5WaWV3XG4gICAgfSlcbiAgfVxuICBsb2dvdXQoKSB7XG4gICAgRGlzcGF0Y2hlci5kaXNwYXRjaCh7XG4gICAgICBhY3Rpb25UeXBlOiBBQ1RJT05TLkxPR09VVFxuICAgIH0pXG4gIH1cblxuICBzaWdudXAoKSB7XG4gICAgRGlzcGF0Y2hlci5kaXNwYXRjaCh7XG4gICAgICBhY3Rpb25UeXBlIDogQUNUSU9OUy5OQVZJR0FURSxcbiAgICAgIHZpZXcgICA6ICdzaWdudXAnXG4gICAgfSlcbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBuZXcgQXBwbGljYXRpb25cbiIsIm1vZHVsZS5leHBvcnRzID0ge1xuICBBUElfVVJMICAgICAgIDogJ2h0dHA6Ly9sb2NhbGhvc3Q6MzAwMCcsXG4gIEFVVEhfSEVBREVSICAgOiAnWC1KV1QtVE9LRU4nLFxuICBBVVRIX0RBVEFfS0VZIDogJ2F1dGhEYXRhJyxcbiAgQUNUSU9OUyAgICAgICA6IHtcbiAgICBOQVZJR0FURSAgICAgICAgICA6ICduYXZpZ2F0ZScsXG4gICAgTE9HSU4gICAgICAgICAgICAgOiAnbG9naW4nLFxuICAgIExPR09VVCAgICAgICAgICAgIDogJ2xvZ291dCcsXG4gICAgU0lHTlVQICAgICAgICAgICAgOiAnc2lnbnVwJyxcbiAgICBTWU5DX0RPQ1VNRU5UUyAgICAgICA6ICdzeW5jX2RvY3VtZW50cycsXG4gICAgQ1JFQVRFX0RPQ1VNRU5UICAgICAgIDogJ2NyZWF0ZV9kb2N1bWVudCcsXG4gICAgU0VMRUNUX0RPQ1VNRU5UICAgICAgIDogJ3NlbGVjdF9kb2N1bWVudCcsXG4gICAgQVJDSElWRV9ET0NVTUVOVCAgICAgICA6ICdhcmNoaXZlX2RvY3VtZW50JyxcbiAgfSxcbn07XG4iLCJpbXBvcnQgRmx1eCBmcm9tICdmbHV4JztcbmV4cG9ydCBkZWZhdWx0IG5ldyBGbHV4LkRpc3BhdGNoZXIoKTtcbiIsImV4cG9ydCBjbGFzcyBOZXR3b3JrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKCBzdGF0dXNDb2RlLCBtZXNzYWdlICkge1xuICAgIHN1cGVyKCk7XG4gICAgdGhpcy5uYW1lICAgICAgID0gJ05ldHdvcmtFcnJvcic7XG4gICAgdGhpcy5tZXNzYWdlICAgID0gbWVzc2FnZSB8fCAnVW5rbm93biBIVFRQIEVycm9yJztcbiAgICB0aGlzLnN0YXR1c0NvZGUgPSBzdGF0dXNDb2RlIHx8IDUwMDtcbiAgICB0aGlzLnN0YWNrICAgICAgPSAobmV3IEVycm9yKCkpLnN0YWNrO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBCYWRSZXF1ZXN0RXJyb3IgZXh0ZW5kcyBOZXR3b3JrRXJyb3Ige1xuICBjb25zdHJ1Y3RvciggZGV0YWlscyApIHtcbiAgICBzdXBlciggNDAwLCAnQmFkIFJlcXVlc3QnICk7XG4gICAgdGhpcy5uYW1lICAgID0gJ0JhZFJlcXVlc3RFcnJvcic7XG4gICAgdGhpcy5kZXRhaWxzID0gZGV0YWlscztcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgVW5hdXRob3JpemVkRXJyb3IgZXh0ZW5kcyBOZXR3b3JrRXJyb3Ige1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlciggNDAxLCAnVW5hdXRob3JpemVkJyApO1xuICAgIHRoaXMubmFtZSA9ICdVbmF1dGhvcml6ZWRFcnJvcic7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIEZvcmJpZGRlbkVycm9yIGV4dGVuZHMgTmV0d29ya0Vycm9yIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoIDQwMywgJ0ZvcmJpZGRlbicgKTtcbiAgICB0aGlzLm5hbWUgPSAnRm9yYmlkZGVuRXJyb3InO1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBOb3RGb3VuZEVycm9yIGV4dGVuZHMgTmV0d29ya0Vycm9yIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoIDQwNCwgJ05vdCBGb3VuZCcgKTtcbiAgICB0aGlzLm5hbWUgPSAnTm90Rm91bmRFcnJvcic7XG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIE1ldGhvZE5vdEFsbG93ZWRFcnJvciBleHRlbmRzIE5ldHdvcmtFcnJvciB7XG4gIGNvbnN0cnVjdG9yKCkge1xuICAgIHN1cGVyKCA0MDUsICdNZXRob2QgTm90IEFsbG93ZWQnICk7XG4gICAgdGhpcy5uYW1lID0gJ01ldGhvZE5vdEFsbG93ZWRFcnJvcic7XG4gIH1cbn1cblxuZXhwb3J0IGZ1bmN0aW9uIGVycm9yRnJvbVhIUiggeGhyICkge1xuICBpZiAoIHhoci5zdGF0dXMgKSB7XG4gICAgc3dpdGNoICggeGhyLnN0YXR1cyApIHtcbiAgICAgIGNhc2UgNDAwOlxuICAgICAgICByZXR1cm4gbmV3IEJhZFJlcXVlc3RFcnJvcigpO1xuICAgICAgICBicmVhaztcblxuICAgICAgY2FzZSA0MDE6XG4gICAgICAgIHJldHVybiBuZXcgVW5hdXRob3JpemVkRXJyb3IoKTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGNhc2UgNDAzOlxuICAgICAgICByZXR1cm4gbmV3IEZvcmJpZGRlbkVycm9yKCk7XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlIDQwNDpcbiAgICAgICAgcmV0dXJuIG5ldyBOb3RGb3VuZEVycm9yKCk7XG4gICAgICAgIGJyZWFrO1xuXG4gICAgICBjYXNlIDQwNTpcbiAgICAgICAgcmV0dXJuIG5ldyBNZXRob2ROb3RBbGxvd2VkRXJyb3IoKTtcbiAgICAgICAgYnJlYWs7XG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIHJldHVybiBuZXcgTmV0d29ya0Vycm9yKCB4aHIuc3RhdHVzLCB4aHIuc3RhdHVzVGV4dCApO1xuICAgICAgICBicmVhaztcbiAgICB9XG4gIH0gZWxzZSB7XG4gICAgLy8gTm90IGFuIFhIUlxuICAgIHJldHVybiB4aHI7XG4gIH1cbn0iLCJpbXBvcnQgYXhpb3MgZnJvbSAnYXhpb3MnXG5pbXBvcnQgeyBBUElfVVJMIH0gZnJvbSAnLi4vY29yZS9jb25zdGFudHMnXG5cbmV4cG9ydCBkZWZhdWx0IHtcbiAgbG9naW46IGRhdGEgPT4gYXhpb3MuZ2V0KGAke0FQSV9VUkx9L2F1dGgvbG9naW5gLCBkYXRhKVxufVxuIiwiaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJ1xuaW1wb3J0IHsgQVBJX1VSTCB9IGZyb20gJy4uL2NvcmUvY29uc3RhbnRzJ1xuaW1wb3J0IHZhbGlkYXRvciBmcm9tICd2YWxpZGF0b3InXG5cbmZ1bmN0aW9uIHZhbGlkYXRlKGRhdGEpIHtcbn1cblxubGV0IGVuZHBvaW50ID0gQVBJX1VSTCArICcvZG9jdW1lbnRzJ1xuZXhwb3J0IGRlZmF1bHQge1xuICBzeW5jICAgOiAoKSAgICAgICA9PiBheGlvcy5nZXQoIGVuZHBvaW50ICksXG4gIGZldGNoICA6IChpZCkgICAgID0+IGF4aW9zLmdldCggZW5kcG9pbnQgKyBgLyR7aWR9YCApLFxuICBjcmVhdGUgOiAoZGF0YSkgICAgID0+IGF4aW9zLnBvc3QoIGVuZHBvaW50LCBkYXRhICksXG4gIHVwZGF0ZSA6IChpZCwgZGF0YSkgPT4gYXhpb3MucHV0KCBlbmRwb2ludCArIGAvJHtpZH1gLCBkYXRhICksXG4gIGRlbGV0ZSA6IChpZCkgICAgICAgPT4gYXhpb3MuZGVsZXRlKCBlbmRwb2ludCArIGAvJHtpZH1gICksXG59XG4iLCIvKipcbiAqIEF1dGhTdG9yZVxuICogYSBzdG9yZSB0aGF0IHVzZXMgYXBpIGNhbGxzIGFuZCBsb2NhbCBzdG9yYWdlIHRvIG1hbmFnZSB0b2tlbiBiYXNlZCB1c2VyIGF1dGhlbnRpY2F0aW9uXG4gKlxuICogZGlzcGF0Y2hlczpcbiAqXG4gKiBoYW5kbGVzOlxuICogICBBQ1RJT05TLkxPR0lOXG4gKiAgIEFDVElPTlMuTE9HT1VUXG4gKlxuICogZW1pdHM6XG4gKiAgIC0gbG9naW46c3VjY2VzcywgbG9naW46ZmFpbHVyZSwgbG9naW46YWN0aXZhdGVcbiAqICAgLSBsb2dvdXQ6c3VjY2Vzc1xuICovXG5cbmltcG9ydCB7IEFDVElPTlMsIEFVVEhfSEVBREVSLCBBVVRIX0RBVEFfS0VZIH0gZnJvbSAnLi4vY29yZS9jb25zdGFudHMnXG5pbXBvcnQgRGlzcGF0Y2hlciBmcm9tICcuLi9jb3JlL2Rpc3BhdGNoZXInXG5pbXBvcnQgRXJyb3JzIGZyb20gJy4uL2NvcmUvZXJyb3JzJ1xuaW1wb3J0IHVzZXJzIGZyb20gJy4uL3Jlc3QvYXV0aCdcbmltcG9ydCB7IEV2ZW50RW1pdHRlciB9IGZyb20gJ2V2ZW50cydcblxuY2xhc3MgQXV0aFN0b3JlIGV4dGVuZHMgRXZlbnRFbWl0dGVyIHtcblxuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcigpXG4gICAgdGhpcy5fYXV0aFRva2VuID0gbnVsbFxuICAgIHRoaXMuX2F1dGhlbnRpY2F0ZWRVc2VyID0gbnVsbFxuICAgIGxldCBkYXRhID0gdGhpcy5nZXRBdXRoRGF0YSgpXG4gICAgaWYgKGRhdGEgJiYgZGF0YS50b2tlbiAmJiBkYXRhLnVzZXIpXG4gICAgICB0aGlzLmF1dGhlbnRpY2F0ZShkYXRhKVxuXG4gICAgRGlzcGF0Y2hlci5yZWdpc3RlcihhY3Rpb24gPT4ge1xuICAgICAgc3dpdGNoIChhY3Rpb24uYWN0aW9uVHlwZSkge1xuICAgICAgICBjYXNlIEFDVElPTlMuTE9HSU46XG4gICAgICAgICAgcmV0dXJuIHRoaXMubG9naW5BY3Rpb24oYWN0aW9uKVxuICAgICAgICBjYXNlIEFDVElPTlMuTE9HT1VUOlxuICAgICAgICAgIHJldHVybiB0aGlzLmxvZ291dEFjdGlvbihhY3Rpb24pXG4gICAgICB9XG4gICAgfSlcbiAgfVxuICAvLyBTYXZlIGF1dGhlbnRpY2F0aW9uIGRhdGEgaW4gbG9jYWwgc3RvcmFnZVxuICBnZXRBdXRoRGF0YSgpe1xuICAgIHJldHVybiBKU09OLnBhcnNlKCBzZXNzaW9uU3RvcmFnZS5nZXRJdGVtKEFVVEhfREFUQV9LRVkpKVxuICB9XG4gIHNldEF1dGhEYXRhKGRhdGEpIHtcbiAgICBzZXNzaW9uU3RvcmFnZS5zZXRJdGVtKEFVVEhfREFUQV9LRVksIEpTT04uc3RyaW5naWZ5KGRhdGEpKVxuICB9XG4gIGNsZWFyQXV0aERhdGEoKSB7XG4gICAgc2Vzc2lvblN0b3JhZ2UucmVtb3ZlSXRlbShBVVRIX0RBVEFfS0VZKVxuICB9XG4gIGlzQXV0aGVudGljYXRlZCgpIHtcbiAgICByZXR1cm4gdHlwZW9mIHRoaXMuX2F1dGhUb2tlbiA9PT0gJ3N0cmluZydcbiAgfVxuXG4gIGF1dGhlbnRpY2F0ZShkYXRhKSB7XG4gICAgdGhpcy5zZXRBdXRoRGF0YShkYXRhKVxuICAgIHRoaXMuX2F1dGhUb2tlbiA9IGRhdGEudG9rZW5cbiAgICB0aGlzLl9hdXRoZW50aWNhdGVkVXNlciA9IGRhdGEudXNlclxuICB9XG5cbiAgYXN5bmMgbG9naW5BY3Rpb24oYWN0aW9uKSB7XG4gICAgdHJ5IHtcbiAgICAgIGxldCB7ZGF0YX0gPSBhd2FpdCB1c2Vycy5sb2dpbih7XG4gICAgICAgIHVzZXJuYW1lOiBhY3Rpb24udXNlcm5hbWUsXG4gICAgICAgIHBhc3N3b3JkOiBhY3Rpb24ucGFzc3dvcmQsXG4gICAgICB9KVxuICAgICAgdGhpcy5hdXRoZW50aWNhdGUoZGF0YSlcbiAgICAgIHRoaXMuZW1pdCggJ2xvZ2luOnN1Y2Nlc3MnLCBkYXRhIClcbiAgICB9IGNhdGNoKGUpIHtcbiAgICAgIGlmICggZSBpbnN0YW5jZW9mIEVycm9ycy5VbmF1dGhvcml6ZWRFcnJvciApIHtcbiAgICAgICAgdGhpcy5lbWl0KCAnbG9naW46ZmFpbHVyZScsIFwiSW5jb3JyZWN0IHVzZXJuYW1lIG9yIHBhc3N3b3JkXCIgKVxuICAgICAgfSBlbHNlIGlmICggZSBpbnN0YW5jZW9mIEVycm9ycy5Gb3JiaWRkZW5FcnJvciApIHtcbiAgICAgICAgdGhpcy5lbWl0KCAnbG9naW46YWN0aXZhdGUnIClcbiAgICAgIH0gZWxzZSBpZiAoIGUgaW5zdGFuY2VvZiBFcnJvcnMuTm90Rm91bmRFcnJvciApIHtcbiAgICAgICAgdGhpcy5lbWl0KCAnbG9naW46ZmFpbHVyZScsIFwiSW5jb3JyZWN0IHVzZXJuYW1lIG9yIHBhc3N3b3JkXCIgKVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgY29uc29sZS5lcnJvciggZS5zdGFjayApXG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgYXN5bmMgbG9nb3V0QWN0aW9uKGFjdGlvbikge1xuICAgIGNvbnNvbGUubG9nKCdsb2dvdXRBY3Rpb24nLCBhY3Rpb24pXG4gICAgdGhpcy5jbGVhckF1dGhEYXRhKClcbiAgICB0aGlzLl9hdXRoVG9rZW4gICAgICAgICA9IG51bGxcbiAgICB0aGlzLl9hdXRoZW50aWNhdGVkVXNlciA9IG51bGxcbiAgICB0aGlzLmVtaXQoICdsb2dvdXQ6c3VjY2VzcycgKVxuICB9XG59XG5leHBvcnQgZGVmYXVsdCBuZXcgQXV0aFN0b3JlKClcbiIsIi8qKlxuICogQXV0aFN0b3JlXG4gKiBhIHN0b3JlIHRoYXQgdXNlcyBhcGkgY2FsbHMgYW5kIGxvY2FsIHN0b3JhZ2UgdG8gbWFuYWdlIHRva2VuIGJhc2VkIHVzZXIgYXV0aGVudGljYXRpb25cbiAqXG4gKiBkaXNwYXRjaGVzOlxuICpcbiAqIGhhbmRsZXM6XG4gKiAgIEFDVElPTlMuU1lOQ19ET0NVTUVOVFNcbiAqXG4gKiBlbWl0czpcbiAqICAgLSBzeW5jOnN1Y2Nlc3MsIHN5bmM6ZmFpbHVyZVxuICovXG5cbiBpbXBvcnQgeyBBQ1RJT05TIH0gZnJvbSAnLi4vY29yZS9jb25zdGFudHMnXG5pbXBvcnQgRGlzcGF0Y2hlciBmcm9tICcuLi9jb3JlL2Rpc3BhdGNoZXInXG5pbXBvcnQgZG9jdW1lbnRzIGZyb20gJy4uL3Jlc3QvZG9jdW1lbnRzJ1xuXG5pbXBvcnQgeyBFdmVudEVtaXR0ZXIgfSBmcm9tICdldmVudHMnXG5cblxuY2xhc3MgRG9jdW1lbnRTdG9yZSBleHRlbmRzIEV2ZW50RW1pdHRlciB7XG5cbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMuc3RhdGUgPSBbXVxuICAgIERpc3BhdGNoZXIucmVnaXN0ZXIoYWN0aW9uID0+IHtcbiAgICAgIHN3aXRjaCAoYWN0aW9uLmFjdGlvblR5cGUpIHtcbiAgICAgICAgY2FzZSBBQ1RJT05TLlNZTkNfRE9DVU1FTlRTOlxuICAgICAgICAgIHJldHVybiB0aGlzLnN5bmMoYWN0aW9uKVxuICAgICAgfVxuICAgIH0pXG4gIH1cbiAgYXN5bmMgc3luYygpIHtcbiAgICBjb25zb2xlLmxvZygnc3luY2luZyBkb2N1bWVudHMnKVxuICAgIHRyeSB7XG4gICAgICBsZXQgeyBkYXRhIH0gPSBhd2FpdCBkb2N1bWVudHMuc3luYygpXG4gICAgICB0aGlzLnN0YXRlID0gZGF0YVxuICAgICAgY29uc29sZS5sb2coJ3N5bmM6c3VjY2VzcycsIGRhdGEpXG4gICAgICB0aGlzLmVtaXQoJ3N5bmM6c3VjY2VzcycpXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5lbWl0KCdzeW5jOmZhaWx1cmUnKVxuICAgIH1cbiAgfVxuICBnZXRTdGF0ZSgpIHtcbiAgICByZXR1cm4gdGhpcy5zdGF0ZVxuICB9XG59XG5leHBvcnQgZGVmYXVsdCBuZXcgRG9jdW1lbnRTdG9yZSgpXG4iXX0=
