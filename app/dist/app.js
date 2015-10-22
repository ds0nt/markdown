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

},{"../adapters/http":2,"../adapters/xhr":2,"_process":76}],6:[function(require,module,exports){
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

},{"component-emitter":21}],15:[function(require,module,exports){
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

},{}],16:[function(require,module,exports){
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
},{"./application":14,"./render":18,"./stringify":19}],17:[function(require,module,exports){
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

},{"component-type":23}],18:[function(require,module,exports){
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

},{"./events":15,"./node-type":17,"./svg":20,"component-raf":22,"fast.js/forEach":26,"fast.js/object/assign":29,"fast.js/reduce":32,"get-uid":33,"is-dom":34,"object-defaults":37,"object-path":38}],19:[function(require,module,exports){
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

},{"./node-type":17,"component-type":23,"object-defaults":37}],20:[function(require,module,exports){
module.exports = {
  isElement: require('is-svg-element').isElement,
  isAttribute: require('is-svg-attribute'),
  namespace: 'http://www.w3.org/2000/svg'
}

},{"is-svg-attribute":35,"is-svg-element":36}],21:[function(require,module,exports){

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

},{}],22:[function(require,module,exports){
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

},{}],23:[function(require,module,exports){
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

},{"buffer":72}],24:[function(require,module,exports){
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

},{"../function/bindInternal3":27}],25:[function(require,module,exports){
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

},{"../function/bindInternal4":28}],26:[function(require,module,exports){
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
},{"./array/forEach":24,"./object/forEach":30}],27:[function(require,module,exports){
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

},{}],28:[function(require,module,exports){
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

},{}],29:[function(require,module,exports){
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

},{}],30:[function(require,module,exports){
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

},{"../function/bindInternal3":27}],31:[function(require,module,exports){
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

},{"../function/bindInternal4":28}],32:[function(require,module,exports){
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
},{"./array/reduce":25,"./object/reduce":31}],33:[function(require,module,exports){
/** generate unique id for selector */
var counter = Date.now() % 1e9;

module.exports = function getUid(){
	return (Math.random() * 1e9 >>> 0) + (counter++);
};
},{}],34:[function(require,module,exports){
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

},{}],35:[function(require,module,exports){
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

},{}],36:[function(require,module,exports){
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

},{}],37:[function(require,module,exports){
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

},{}],38:[function(require,module,exports){
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

},{}],39:[function(require,module,exports){


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
},{}],40:[function(require,module,exports){
/**
 * Copyright (c) 2014-2015, Facebook, Inc.
 * All rights reserved.
 *
 * This source code is licensed under the BSD-style license found in the
 * LICENSE file in the root directory of this source tree. An additional grant
 * of patent rights can be found in the PATENTS file in the same directory.
 */

module.exports.Dispatcher = require('./lib/Dispatcher');

},{"./lib/Dispatcher":41}],41:[function(require,module,exports){
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

},{"_process":76,"fbjs/lib/invariant":42}],42:[function(require,module,exports){
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

},{"_process":76}],43:[function(require,module,exports){
/**
 * lodash 3.1.1 (Custom Build) <https://lodash.com/>
 * Build: `lodash modern modularize exports="npm" -o ./`
 * Copyright 2012-2015 The Dojo Foundation <http://dojofoundation.org/>
 * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
 * Copyright 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
 * Available under MIT license <https://lodash.com/license>
 */
var getNative = require('lodash._getnative');

/** Used as the `TypeError` message for "Functions" methods. */
var FUNC_ERROR_TEXT = 'Expected a function';

/* Native method references for those with the same name as other `lodash` methods. */
var nativeMax = Math.max,
    nativeNow = getNative(Date, 'now');

/**
 * Gets the number of milliseconds that have elapsed since the Unix epoch
 * (1 January 1970 00:00:00 UTC).
 *
 * @static
 * @memberOf _
 * @category Date
 * @example
 *
 * _.defer(function(stamp) {
 *   console.log(_.now() - stamp);
 * }, _.now());
 * // => logs the number of milliseconds it took for the deferred function to be invoked
 */
var now = nativeNow || function() {
  return new Date().getTime();
};

/**
 * Creates a debounced function that delays invoking `func` until after `wait`
 * milliseconds have elapsed since the last time the debounced function was
 * invoked. The debounced function comes with a `cancel` method to cancel
 * delayed invocations. Provide an options object to indicate that `func`
 * should be invoked on the leading and/or trailing edge of the `wait` timeout.
 * Subsequent calls to the debounced function return the result of the last
 * `func` invocation.
 *
 * **Note:** If `leading` and `trailing` options are `true`, `func` is invoked
 * on the trailing edge of the timeout only if the the debounced function is
 * invoked more than once during the `wait` timeout.
 *
 * See [David Corbacho's article](http://drupalmotion.com/article/debounce-and-throttle-visual-explanation)
 * for details over the differences between `_.debounce` and `_.throttle`.
 *
 * @static
 * @memberOf _
 * @category Function
 * @param {Function} func The function to debounce.
 * @param {number} [wait=0] The number of milliseconds to delay.
 * @param {Object} [options] The options object.
 * @param {boolean} [options.leading=false] Specify invoking on the leading
 *  edge of the timeout.
 * @param {number} [options.maxWait] The maximum time `func` is allowed to be
 *  delayed before it is invoked.
 * @param {boolean} [options.trailing=true] Specify invoking on the trailing
 *  edge of the timeout.
 * @returns {Function} Returns the new debounced function.
 * @example
 *
 * // avoid costly calculations while the window size is in flux
 * jQuery(window).on('resize', _.debounce(calculateLayout, 150));
 *
 * // invoke `sendMail` when the click event is fired, debouncing subsequent calls
 * jQuery('#postbox').on('click', _.debounce(sendMail, 300, {
 *   'leading': true,
 *   'trailing': false
 * }));
 *
 * // ensure `batchLog` is invoked once after 1 second of debounced calls
 * var source = new EventSource('/stream');
 * jQuery(source).on('message', _.debounce(batchLog, 250, {
 *   'maxWait': 1000
 * }));
 *
 * // cancel a debounced call
 * var todoChanges = _.debounce(batchLog, 1000);
 * Object.observe(models.todo, todoChanges);
 *
 * Object.observe(models, function(changes) {
 *   if (_.find(changes, { 'user': 'todo', 'type': 'delete'})) {
 *     todoChanges.cancel();
 *   }
 * }, ['delete']);
 *
 * // ...at some point `models.todo` is changed
 * models.todo.completed = true;
 *
 * // ...before 1 second has passed `models.todo` is deleted
 * // which cancels the debounced `todoChanges` call
 * delete models.todo;
 */
function debounce(func, wait, options) {
  var args,
      maxTimeoutId,
      result,
      stamp,
      thisArg,
      timeoutId,
      trailingCall,
      lastCalled = 0,
      maxWait = false,
      trailing = true;

  if (typeof func != 'function') {
    throw new TypeError(FUNC_ERROR_TEXT);
  }
  wait = wait < 0 ? 0 : (+wait || 0);
  if (options === true) {
    var leading = true;
    trailing = false;
  } else if (isObject(options)) {
    leading = !!options.leading;
    maxWait = 'maxWait' in options && nativeMax(+options.maxWait || 0, wait);
    trailing = 'trailing' in options ? !!options.trailing : trailing;
  }

  function cancel() {
    if (timeoutId) {
      clearTimeout(timeoutId);
    }
    if (maxTimeoutId) {
      clearTimeout(maxTimeoutId);
    }
    lastCalled = 0;
    maxTimeoutId = timeoutId = trailingCall = undefined;
  }

  function complete(isCalled, id) {
    if (id) {
      clearTimeout(id);
    }
    maxTimeoutId = timeoutId = trailingCall = undefined;
    if (isCalled) {
      lastCalled = now();
      result = func.apply(thisArg, args);
      if (!timeoutId && !maxTimeoutId) {
        args = thisArg = undefined;
      }
    }
  }

  function delayed() {
    var remaining = wait - (now() - stamp);
    if (remaining <= 0 || remaining > wait) {
      complete(trailingCall, maxTimeoutId);
    } else {
      timeoutId = setTimeout(delayed, remaining);
    }
  }

  function maxDelayed() {
    complete(trailing, timeoutId);
  }

  function debounced() {
    args = arguments;
    stamp = now();
    thisArg = this;
    trailingCall = trailing && (timeoutId || !leading);

    if (maxWait === false) {
      var leadingCall = leading && !timeoutId;
    } else {
      if (!maxTimeoutId && !leading) {
        lastCalled = stamp;
      }
      var remaining = maxWait - (stamp - lastCalled),
          isCalled = remaining <= 0 || remaining > maxWait;

      if (isCalled) {
        if (maxTimeoutId) {
          maxTimeoutId = clearTimeout(maxTimeoutId);
        }
        lastCalled = stamp;
        result = func.apply(thisArg, args);
      }
      else if (!maxTimeoutId) {
        maxTimeoutId = setTimeout(maxDelayed, remaining);
      }
    }
    if (isCalled && timeoutId) {
      timeoutId = clearTimeout(timeoutId);
    }
    else if (!timeoutId && wait !== maxWait) {
      timeoutId = setTimeout(delayed, wait);
    }
    if (leadingCall) {
      isCalled = true;
      result = func.apply(thisArg, args);
    }
    if (isCalled && !timeoutId && !maxTimeoutId) {
      args = thisArg = undefined;
    }
    return result;
  }
  debounced.cancel = cancel;
  return debounced;
}

/**
 * Checks if `value` is the [language type](https://es5.github.io/#x8) of `Object`.
 * (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
 *
 * @static
 * @memberOf _
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
 * @example
 *
 * _.isObject({});
 * // => true
 *
 * _.isObject([1, 2, 3]);
 * // => true
 *
 * _.isObject(1);
 * // => false
 */
function isObject(value) {
  // Avoid a V8 JIT bug in Chrome 19-20.
  // See https://code.google.com/p/v8/issues/detail?id=2291 for more details.
  var type = typeof value;
  return !!value && (type == 'object' || type == 'function');
}

module.exports = debounce;

},{"lodash._getnative":44}],44:[function(require,module,exports){
/**
 * lodash 3.9.1 (Custom Build) <https://lodash.com/>
 * Build: `lodash modern modularize exports="npm" -o ./`
 * Copyright 2012-2015 The Dojo Foundation <http://dojofoundation.org/>
 * Based on Underscore.js 1.8.3 <http://underscorejs.org/LICENSE>
 * Copyright 2009-2015 Jeremy Ashkenas, DocumentCloud and Investigative Reporters & Editors
 * Available under MIT license <https://lodash.com/license>
 */

/** `Object#toString` result references. */
var funcTag = '[object Function]';

/** Used to detect host constructors (Safari > 5). */
var reIsHostCtor = /^\[object .+?Constructor\]$/;

/**
 * Checks if `value` is object-like.
 *
 * @private
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is object-like, else `false`.
 */
function isObjectLike(value) {
  return !!value && typeof value == 'object';
}

/** Used for native method references. */
var objectProto = Object.prototype;

/** Used to resolve the decompiled source of functions. */
var fnToString = Function.prototype.toString;

/** Used to check objects for own properties. */
var hasOwnProperty = objectProto.hasOwnProperty;

/**
 * Used to resolve the [`toStringTag`](http://ecma-international.org/ecma-262/6.0/#sec-object.prototype.tostring)
 * of values.
 */
var objToString = objectProto.toString;

/** Used to detect if a method is native. */
var reIsNative = RegExp('^' +
  fnToString.call(hasOwnProperty).replace(/[\\^$.*+?()[\]{}|]/g, '\\$&')
  .replace(/hasOwnProperty|(function).*?(?=\\\()| for .+?(?=\\\])/g, '$1.*?') + '$'
);

/**
 * Gets the native function at `key` of `object`.
 *
 * @private
 * @param {Object} object The object to query.
 * @param {string} key The key of the method to get.
 * @returns {*} Returns the function if it's native, else `undefined`.
 */
function getNative(object, key) {
  var value = object == null ? undefined : object[key];
  return isNative(value) ? value : undefined;
}

/**
 * Checks if `value` is classified as a `Function` object.
 *
 * @static
 * @memberOf _
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is correctly classified, else `false`.
 * @example
 *
 * _.isFunction(_);
 * // => true
 *
 * _.isFunction(/abc/);
 * // => false
 */
function isFunction(value) {
  // The use of `Object#toString` avoids issues with the `typeof` operator
  // in older versions of Chrome and Safari which return 'function' for regexes
  // and Safari 8 equivalents which return 'object' for typed array constructors.
  return isObject(value) && objToString.call(value) == funcTag;
}

/**
 * Checks if `value` is the [language type](https://es5.github.io/#x8) of `Object`.
 * (e.g. arrays, functions, objects, regexes, `new Number(0)`, and `new String('')`)
 *
 * @static
 * @memberOf _
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is an object, else `false`.
 * @example
 *
 * _.isObject({});
 * // => true
 *
 * _.isObject([1, 2, 3]);
 * // => true
 *
 * _.isObject(1);
 * // => false
 */
function isObject(value) {
  // Avoid a V8 JIT bug in Chrome 19-20.
  // See https://code.google.com/p/v8/issues/detail?id=2291 for more details.
  var type = typeof value;
  return !!value && (type == 'object' || type == 'function');
}

/**
 * Checks if `value` is a native function.
 *
 * @static
 * @memberOf _
 * @category Lang
 * @param {*} value The value to check.
 * @returns {boolean} Returns `true` if `value` is a native function, else `false`.
 * @example
 *
 * _.isNative(Array.prototype.push);
 * // => true
 *
 * _.isNative(_);
 * // => false
 */
function isNative(value) {
  if (value == null) {
    return false;
  }
  if (isFunction(value)) {
    return reIsNative.test(fnToString.call(value));
  }
  return isObjectLike(value) && reIsHostCtor.test(value);
}

module.exports = getNative;

},{}],45:[function(require,module,exports){
/* eslint-disable no-unused-vars */
'use strict';
var hasOwnProperty = Object.prototype.hasOwnProperty;
var propIsEnumerable = Object.prototype.propertyIsEnumerable;

function toObject(val) {
	if (val === null || val === undefined) {
		throw new TypeError('Object.assign cannot be called with null or undefined');
	}

	return Object(val);
}

module.exports = Object.assign || function (target, source) {
	var from;
	var to = toObject(target);
	var symbols;

	for (var s = 1; s < arguments.length; s++) {
		from = Object(arguments[s]);

		for (var key in from) {
			if (hasOwnProperty.call(from, key)) {
				to[key] = from[key];
			}
		}

		if (Object.getOwnPropertySymbols) {
			symbols = Object.getOwnPropertySymbols(from);
			for (var i = 0; i < symbols.length; i++) {
				if (propIsEnumerable.call(from, symbols[i])) {
					to[symbols[i]] = from[symbols[i]];
				}
			}
		}
	}

	return to;
};

},{}],46:[function(require,module,exports){
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

},{"array-flatten":47,"sliced":48}],47:[function(require,module,exports){
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

},{}],48:[function(require,module,exports){
module.exports = exports = require('./lib/sliced');

},{"./lib/sliced":49}],49:[function(require,module,exports){

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


},{}],50:[function(require,module,exports){
'use strict';

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _coreConstants = require('./core/constants');

var _coreDispatcher = require('./core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var _coreApplication = require('./core/application');

var _coreApplication2 = _interopRequireDefault(_coreApplication);

_coreApplication2['default'].start();

},{"./core/application":62,"./core/constants":63,"./core/dispatcher":64}],51:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _virtualElement = require('virtual-element');

var _virtualElement2 = _interopRequireDefault(_virtualElement);

var _docEditor = require('./doc-editor');

var _docEditor2 = _interopRequireDefault(_docEditor);

var _docList = require('./doc-list');

var _docList2 = _interopRequireDefault(_docList);

var _docToolbar = require('./doc-toolbar');

var _docToolbar2 = _interopRequireDefault(_docToolbar);

var _import = require('./import');

var _import2 = _interopRequireDefault(_import);

exports['default'] = {
  render: function render() {
    return (0, _virtualElement2['default'])(
      'div',
      { 'class': 'ui container' },
      (0, _virtualElement2['default'])(_docToolbar2['default'], null),
      (0, _virtualElement2['default'])(_docList2['default'], { title: 'documents' }),
      (0, _virtualElement2['default'])(_docEditor2['default'], null),
      (0, _virtualElement2['default'])(_import2['default'], null)
    );
  }
};
module.exports = exports['default'];

},{"./doc-editor":52,"./doc-list":53,"./doc-toolbar":54,"./import":57,"virtual-element":46}],52:[function(require,module,exports){
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

var _lodashDebounce = require('lodash.debounce');

var _lodashDebounce2 = _interopRequireDefault(_lodashDebounce);

var trailingSave = (0, _lodashDebounce2['default'])(function (documentId, body) {
  console.log('debounce save');
  _storesDocument2['default'].save(documentId, { body: body });
}, 500, { leading: false, maxWait: 5000, trailing: true });

var DocumentEditor = {
  initialState: function initialState(props) {
    return {
      loaded: false,
      doc: null,
      saveHandler: function saveHandler() {},
      offSave: { off: function off() {} }
    };
  },
  shouldUpdate: function shouldUpdate(component, nextProps, nextState) {
    var props = component.props;
    var state = component.state;
    var id = component.id;

    return state.doc !== nextState.doc;
  },

  beforeUpdate: function beforeUpdate(component, nextProps, nextState) {
    var props = component.props;
    var state = component.state;
    var id = component.id;

    if (typeof state.editor !== 'undefined') {
      state.editor.removeListener("update");
    }
    state.offSave.off();
  },

  afterUpdate: function afterUpdate(component, prevProps, prevState, setState) {
    var _this = this;

    var props = component.props;
    var state = component.state;
    var id = component.id;

    state.editor.importFile(state.doc.id, state.doc.body);

    state.editor.on("update", function () {
      // immediately cache the html bodyz
      var body = state.editor.exportFile();
      var documentId = state.doc.id;
      trailingSave(documentId, body);
    });
    // document selected listener
    setState({
      offSave: _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.SAVE_DOCUMENT, function callee$1$0() {
        var body, documentId;
        return regeneratorRuntime.async(function callee$1$0$(context$2$0) {
          while (1) switch (context$2$0.prev = context$2$0.next) {
            case 0:
              body = state.editor.exportFile();
              documentId = state.doc.id;
              context$2$0.next = 4;
              return regeneratorRuntime.awrap(_storesDocument2['default'].save(documentId, { body: body }));

            case 4:
              context$2$0.next = 6;
              return regeneratorRuntime.awrap(_storesDocument2['default'].sync());

            case 6:
            case 'end':
              return context$2$0.stop();
          }
        }, null, _this);
      })
    });
  },

  afterMount: function afterMount(c, el, setState) {
    var editor;
    return regeneratorRuntime.async(function afterMount$(context$1$0) {
      var _this2 = this;

      while (1) switch (context$1$0.prev = context$1$0.next) {
        case 0:
          editor = new EpicEditor({
            clientSideStorage: false,
            basePath: 'epiceditor',
            autogrow: true,
            minHeight: function minHeight() {
              return Math.max(document.body.scrollHeight, document.body.offsetHeight, document.documentElement.clientHeight, document.documentElement.scrollHeight, document.documentElement.offsetHeight);
            }
          });

          editor.load();
          setState({
            editor: editor
          });
          _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.FULLSCREEN_DOCUMENT, function () {
            return editor.enterFullscreen();
          });
          _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.PREVIEW_DOCUMENT, function () {
            return editor.is('preview') ? editor.edit() : editor.preview();
          });
          _storesDocument2['default'].onAction('update', function callee$1$0(data) {
            var doc;
            return regeneratorRuntime.async(function callee$1$0$(context$2$0) {
              while (1) switch (context$2$0.prev = context$2$0.next) {
                case 0:
                  try {
                    doc = _storesDocument2['default'].getState().selected;

                    setState({
                      loaded: true,
                      doc: doc
                    });
                  } catch (e) {
                    console.error(e);
                  }

                case 1:
                case 'end':
                  return context$2$0.stop();
              }
            }, null, _this2);
          });

        case 6:
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

},{"../core/constants":63,"../core/dispatcher":64,"../stores/document":71,"lodash.debounce":43,"virtual-element":46}],53:[function(require,module,exports){
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
      return _coreDispatcher2['default'].dispatchAction(_coreConstants.ACTIONS.SELECT_DOCUMENT, { id: _item.id });
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

exports['default'] = {
  name: 'DocumentList',
  initialState: function initialState(props) {
    return {
      documents: [],
      selected: null,
      loading: false,
      docsHandler: { off: function off() {} }
    };
  },
  afterMount: function afterMount(component, el, setState) {
    var _DocumentStore$getState = _storesDocument2['default'].getState();

    var _DocumentStore$getState$documents = _DocumentStore$getState.documents;
    var documents = _DocumentStore$getState$documents === undefined ? [] : _DocumentStore$getState$documents;

    setState({
      documents: documents,
      docsHandler: _storesDocument2['default'].onAction('update', function (data) {
        setState({
          documents: _storesDocument2['default'].getState().documents,
          selected: data.selected ? data.selected.id : null,
          loading: false
        });
      })
    });
  },
  beforeUnmount: function beforeUnmount(component, el) {
    var props = component.props;
    var state = component.state;
    var id = component.id;

    state.docsHandler.off();
  },
  render: function render(_ref3, setState) {
    var props = _ref3.props;
    var state = _ref3.state;
    var documents = state.documents;

    var list = documents.map(function (item) {
      return (0, _virtualElement2['default'])(DocumentItem, { active: item.id === state.selected, item: item });
    });

    return (0, _virtualElement2['default'])(
      'div',
      { id: 'document-list', 'class': 'ui left fixed vertical menu' },
      (0, _virtualElement2['default'])(
        'div',
        { 'class': 'ui horizontal divider' },
        'NotePad'
      ),
      (0, _virtualElement2['default'])(
        Loader,
        { active: state.loading },
        'Loading'
      ),
      list
    );
  }
};
module.exports = exports['default'];

},{"../core/constants":63,"../core/dispatcher":64,"../stores/document":71,"virtual-element":46}],54:[function(require,module,exports){
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

var _dropdown = require('./dropdown');

var _dropdown2 = _interopRequireDefault(_dropdown);

var Toolbar = {
  afterRender: function afterRender(component, el) {
    $(el).find(".dropdown").dropdown();
  },
  render: function render() {
    var newDocument = function newDocument() {
      return _coreDispatcher2['default'].dispatchAction(_coreConstants.ACTIONS.CREATE_DOCUMENT);
    };
    var removeDocument = function removeDocument() {
      return _coreDispatcher2['default'].dispatchAction(_coreConstants.ACTIONS.REMOVE_DOCUMENT);
    };
    var saveDocument = function saveDocument() {
      return _coreDispatcher2['default'].dispatchAction(_coreConstants.ACTIONS.SAVE_DOCUMENT);
    };
    var previewDocument = function previewDocument() {
      return _coreDispatcher2['default'].dispatchAction(_coreConstants.ACTIONS.PREVIEW_DOCUMENT);
    };
    var fullScreenDocument = function fullScreenDocument() {
      return _coreDispatcher2['default'].dispatchAction(_coreConstants.ACTIONS.FULLSCREEN_DOCUMENT);
    };

    return (0, _virtualElement2['default'])(
      'div',
      { id: 'toolbar', 'class': 'ui stacking icon basic buttons' },
      (0, _virtualElement2['default'])(
        'button',
        { 'class': 'ui button', onClick: newDocument },
        (0, _virtualElement2['default'])('i', { 'class': 'plus icon' })
      ),
      (0, _virtualElement2['default'])(
        'button',
        { 'class': 'ui button', onClick: removeDocument },
        (0, _virtualElement2['default'])('i', { 'class': 'trash icon' })
      ),
      (0, _virtualElement2['default'])(
        'button',
        { 'class': 'ui button', onClick: saveDocument },
        (0, _virtualElement2['default'])('i', { 'class': 'save icon' })
      ),
      (0, _virtualElement2['default'])(
        'button',
        { 'class': 'ui button', onClick: previewDocument },
        (0, _virtualElement2['default'])('i', { 'class': 'preview icon' })
      ),
      (0, _virtualElement2['default'])(
        'button',
        { 'class': 'ui button', onClick: fullScreenDocument },
        (0, _virtualElement2['default'])('i', { 'class': 'full screen icon' })
      ),
      (0, _virtualElement2['default'])(
        'div',
        { 'class': 'ui dropdown button' },
        (0, _virtualElement2['default'])(
          'div',
          { 'class': 'text' },
          'Settings'
        ),
        (0, _virtualElement2['default'])('i', { 'class': 'dropdown icon' }),
        (0, _virtualElement2['default'])(_dropdown2['default'], { name: 'Settings', items: [{ name: "Import", icon: "import", description: "Import documents", onClick: function onClick() {
              return _coreDispatcher2['default'].dispatch({ actionType: _coreConstants.ACTIONS.OPEN_IMPORT });
            } }, { name: "Logout", icon: "sign out", description: "Go back to login", onClick: function onClick() {
              return _coreDispatcher2['default'].dispatch({ actionType: _coreConstants.ACTIONS.SET_ROUTE, route: '/logout' });
            } }] })
      )
    );
  }
};

exports['default'] = Toolbar;
module.exports = exports['default'];

},{"../core/constants":63,"../core/dispatcher":64,"./dropdown":55,"virtual-element":46}],55:[function(require,module,exports){
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

var Dropdown = {

  afterRender: function afterRender(component, el) {
    $(el).dropdown();
  },

  render: function render(component) {
    var state = component.state;
    var props = component.props;
    var _props$items = props.items;
    var items = _props$items === undefined ? [] : _props$items;

    var newDocument = function newDocument() {
      return _coreDispatcher2['default'].dispatch({
        actionType: _coreConstants.ACTIONS.CREATE_DOCUMENT
      });
    };

    items = items.map(function (child) {
      return (0, _virtualElement2['default'])(
        'div',
        { 'class': 'item', onClick: child.onClick },
        !child.icon ? '' : (0, _virtualElement2['default'])('i', { 'class': child.icon + ' icon' }),
        !child.description ? '' : (0, _virtualElement2['default'])(
          'span',
          { 'class': 'description' },
          child.description
        ),
        child.name
      );
    });

    return (0, _virtualElement2['default'])(
      'div',
      { 'class': 'menu' },
      items
    );
  }
};

exports['default'] = Dropdown;
module.exports = exports['default'];

},{"../core/constants":63,"../core/dispatcher":64,"virtual-element":46}],56:[function(require,module,exports){
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

},{"virtual-element":46}],57:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var _virtualElement = require('virtual-element');

var _virtualElement2 = _interopRequireDefault(_virtualElement);

var _coreConstants = require('../core/constants');

var _coreDispatcher = require('../core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var Dropdown = {

  afterMount: function afterMount(component, el, setState) {
    _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.OPEN_IMPORT, function () {
      return $(el).modal('show');
    });
  },

  render: function render(component) {
    var state = component.state;
    var props = component.props;

    var onChangeField = function onChangeField(name) {
      return function (e, c, setState) {
        setState(_defineProperty({}, name, e.target.value));
      };
    };

    var submit = function submit() {
      alert(state.url);
    };

    return (0, _virtualElement2['default'])(
      'div',
      { 'class': 'ui basic modal' },
      (0, _virtualElement2['default'])('i', { 'class': 'close icon' }),
      (0, _virtualElement2['default'])(
        'div',
        { 'class': 'header' },
        'Archive Old Messages'
      ),
      (0, _virtualElement2['default'])(
        'div',
        { 'class': 'content' },
        (0, _virtualElement2['default'])(
          'div',
          { 'class': 'ui form' },
          (0, _virtualElement2['default'])(
            'h4',
            { 'class': 'ui dividing header' },
            'Give us your feedback'
          ),
          (0, _virtualElement2['default'])(
            'div',
            { 'class': 'field' },
            (0, _virtualElement2['default'])(
              'label',
              null,
              'URL'
            ),
            (0, _virtualElement2['default'])('input', { type: 'text', onChange: onChangeField("url") })
          )
        )
      ),
      (0, _virtualElement2['default'])(
        'div',
        { 'class': 'actions' },
        (0, _virtualElement2['default'])(
          'div',
          { 'class': 'two fluid ui inverted buttons' },
          (0, _virtualElement2['default'])(
            'div',
            { 'class': 'ui green basic inverted button', onClick: submit },
            (0, _virtualElement2['default'])('i', { 'class': 'checkmark icon' }),
            'Yes'
          )
        )
      )
    );
  }
};

exports['default'] = Dropdown;
module.exports = exports['default'];

},{"../core/constants":63,"../core/dispatcher":64,"virtual-element":46}],58:[function(require,module,exports){
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

var _appView = require('./app-view');

var _appView2 = _interopRequireDefault(_appView);

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
    _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.SET_VIEW, function (_ref) {
      var view = _ref.view;
      return update({ 'view': view });
    });
  },
  render: function render(c) {
    var View = c.state.view;
    return (0, _virtualElement2['default'])(
      'main',
      null,
      (0, _virtualElement2['default'])(_forkme2['default'], { repo: 'ds0nt/mdpad' }),
      (0, _virtualElement2['default'])(View, null)
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

},{"../core/constants":63,"../core/dispatcher":64,"./app-view":51,"./forkme":56,"deku":16,"virtual-element":46}],59:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var _virtualElement = require('virtual-element');

var _virtualElement2 = _interopRequireDefault(_virtualElement);

var _storesAuth = require('../stores/auth');

var _storesAuth2 = _interopRequireDefault(_storesAuth);

var _coreDispatcher = require('../core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var _coreConstants = require('../core/constants');

var initialState = function initialState() {
  return {
    email: '',
    password: '',
    submitting: false,
    error: ''
  };
};
var afterMount = function afterMount(c, el, setState) {
  setState({
    loginHandler: _storesAuth2['default'].onAction('login:failure', function (_ref) {
      var error = _ref.error;

      setState({
        submitting: false,
        error: error
      });
    })

  });
};

var beforeUnmount = function beforeUnmount(component) {
  var state = component.state;

  state.loginHandler.off();
};

var render = function render(c) {
  var state = c.state;
  var props = c.props;

  var buttonContent = 'Login';
  if (state.submitting) {
    buttonContent = (0, _virtualElement2['default'])('img', { src: '/img/loading.gif', alt: 'Logging in...' });
  }

  var onChangeField = function onChangeField(name) {
    return function (e, c, setState) {
      setState(_defineProperty({}, name, e.target.value));
    };
  };
  function signup() {
    _coreDispatcher2['default'].dispatch({
      actionType: _coreConstants.ACTIONS.SET_ROUTE,
      route: '/register'
    });
  }

  function handleSubmit(e, component, setState) {
    e.preventDefault();
    setState({
      submitting: true,
      error: ''
    });
    _coreDispatcher2['default'].dispatch({
      actionType: _coreConstants.ACTIONS.LOGIN,
      email: component.state.email,
      password: component.state.password
    });
    return false;
  }

  return (0, _virtualElement2['default'])(
    'div',
    { 'class': 'ui fluid doubling grid centered container' },
    (0, _virtualElement2['default'])(
      'div',
      { 'class': 'row' },
      (0, _virtualElement2['default'])(
        'div',
        { 'class': 'four wide column login-page' },
        (0, _virtualElement2['default'])(
          'div',
          { 'class': 'ui ' + (state.submitting ? 'loading' : '') + ' ' + (state.error !== '' ? 'error' : '') + ' form' },
          (0, _virtualElement2['default'])(
            'form',
            null,
            (0, _virtualElement2['default'])(
              'h2',
              null,
              'Login'
            ),
            (0, _virtualElement2['default'])(
              'div',
              { 'class': 'field' },
              (0, _virtualElement2['default'])(
                'label',
                null,
                'E-mail'
              ),
              (0, _virtualElement2['default'])('input', { name: 'email', type: 'email', onChange: onChangeField('email'), value: state.email, placeholder: 'joe@schmoe.com' }),
              (0, _virtualElement2['default'])(
                'label',
                null,
                'Password'
              ),
              (0, _virtualElement2['default'])('input', { name: 'password', type: 'password', onChange: onChangeField('password'), value: state.password, placeholder: 'Password' })
            ),
            (0, _virtualElement2['default'])(
              'button',
              { type: 'button', onClick: handleSubmit, 'class': 'ui submit button' },
              buttonContent
            ),
            state.error !== '' ? (0, _virtualElement2['default'])(
              'div',
              { 'class': 'ui error message' },
              (0, _virtualElement2['default'])(
                'div',
                { 'class': 'header' },
                'Login Error'
              ),
              (0, _virtualElement2['default'])(
                'p',
                null,
                state.error
              )
            ) : ''
          )
        ),
        (0, _virtualElement2['default'])(
          'p',
          { 'class': 'login-signup-link' },
          (0, _virtualElement2['default'])(
            'a',
            { onClick: signup },
            'Need an account?'
          )
        )
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

},{"../core/constants":63,"../core/dispatcher":64,"../stores/auth":70,"virtual-element":46}],60:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _defineProperty(obj, key, value) { if (key in obj) { Object.defineProperty(obj, key, { value: value, enumerable: true, configurable: true, writable: true }); } else { obj[key] = value; } return obj; }

var _virtualElement = require('virtual-element');

var _virtualElement2 = _interopRequireDefault(_virtualElement);

var _storesAuth = require('../stores/auth');

var _storesAuth2 = _interopRequireDefault(_storesAuth);

var _coreDispatcher = require('../core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var _coreConstants = require('../core/constants');

var initialState = function initialState() {
  return {
    email: '',
    password: '',
    password2: '',
    submitting: false,
    error: ''
  };
};
var afterMount = function afterMount(c, el, setState) {
  setState({
    registerHandler: _storesAuth2['default'].onAction('register:failure', function (_ref) {
      var error = _ref.error;

      setState({
        submitting: false,
        error: error
      });
    })

  });
};

var beforeUnmount = function beforeUnmount(component) {
  var state = component.state;

  state.registerHandler.off();
};
var render = function render(c) {
  var state = c.state;
  var props = c.props;

  var buttonContent = 'Register';
  if (state.submitting) {
    buttonContent = (0, _virtualElement2['default'])('img', { src: '/img/loading.gif', alt: 'Logging in...' });
  }

  var onChangeField = function onChangeField(name) {
    return function (e, c, setState) {
      setState(_defineProperty({}, name, e.target.value));
    };
  };

  function handleSubmit(e, component, setState) {
    e.preventDefault();
    var props = component.props;
    var state = component.state;

    if (state.password !== state.password2) {
      setState({
        submitting: false,
        error: 'Passwords do not match'
      });
      return;
    }
    setState({
      submitting: true,
      error: ''
    });
    _coreDispatcher2['default'].dispatch({
      actionType: _coreConstants.ACTIONS.REGISTER,
      email: state.email,
      password: state.password
    });
    return false;
  }

  function login() {
    _coreDispatcher2['default'].dispatch({
      actionType: _coreConstants.ACTIONS.SET_ROUTE,
      route: '/login'
    });
  }

  return (0, _virtualElement2['default'])(
    'div',
    { 'class': 'ui container' },
    (0, _virtualElement2['default'])(
      'div',
      { 'class': 'register-page' },
      (0, _virtualElement2['default'])(
        'div',
        { 'class': 'ui ' + (state.submitting ? 'loading' : '') + ' ' + (state.error !== '' ? 'error' : '') + ' form' },
        (0, _virtualElement2['default'])(
          'form',
          null,
          (0, _virtualElement2['default'])(
            'h2',
            null,
            'Register'
          ),
          (0, _virtualElement2['default'])(
            'div',
            { 'class': 'field' },
            (0, _virtualElement2['default'])(
              'label',
              null,
              'E-mail'
            ),
            (0, _virtualElement2['default'])('input', { name: 'email', type: 'email', onChange: onChangeField('email'), value: state.email, placeholder: 'joe@schmoe.com' }),
            (0, _virtualElement2['default'])(
              'label',
              null,
              'Password'
            ),
            (0, _virtualElement2['default'])('input', { name: 'password', type: 'password', onChange: onChangeField('password'), value: state.password, placeholder: 'Password' }),
            (0, _virtualElement2['default'])(
              'label',
              null,
              'Confirm Password'
            ),
            (0, _virtualElement2['default'])('input', { name: 'password2', type: 'password', onChange: onChangeField('password2'), value: state.password2, placeholder: 'Confirm Password' })
          ),
          (0, _virtualElement2['default'])(
            'button',
            { type: 'button', onClick: handleSubmit, 'class': 'ui submit button' },
            buttonContent
          ),
          state.error !== '' ? (0, _virtualElement2['default'])(
            'div',
            { 'class': 'ui error message' },
            (0, _virtualElement2['default'])(
              'div',
              { 'class': 'header' },
              'Registation Error'
            ),
            (0, _virtualElement2['default'])(
              'p',
              null,
              state.error
            )
          ) : ''
        )
      ),
      (0, _virtualElement2['default'])(
        'p',
        { 'class': 'register-signup-link' },
        (0, _virtualElement2['default'])(
          'a',
          { onClick: login },
          'Already have an account?'
        )
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

},{"../core/constants":63,"../core/dispatcher":64,"../stores/auth":70,"virtual-element":46}],61:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

var _get = function get(_x, _x2, _x3) { var _again = true; _function: while (_again) { var object = _x, property = _x2, receiver = _x3; desc = parent = getter = undefined; _again = false; if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { _x = parent; _x2 = property; _x3 = receiver; _again = true; continue _function; } } else if ('value' in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } } };

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _objectWithoutProperties(obj, keys) { var target = {}; for (var i in obj) { if (keys.indexOf(i) >= 0) continue; if (!Object.prototype.hasOwnProperty.call(obj, i)) continue; target[i] = obj[i]; } return target; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

function _inherits(subClass, superClass) { if (typeof superClass !== 'function' && superClass !== null) { throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var _flux = require('flux');

var _flux2 = _interopRequireDefault(_flux);

function stackFrom() {
  var err = new Error();
  return window.printFrom ? err.stack.split('\n')[3] : "";
}

var Dispatcher = (function (_Flux$Dispatcher) {
  _inherits(Dispatcher, _Flux$Dispatcher);

  function Dispatcher() {
    _classCallCheck(this, Dispatcher);

    _get(Object.getPrototypeOf(Dispatcher.prototype), 'constructor', this).apply(this, arguments);
  }

  _createClass(Dispatcher, [{
    key: 'dispatchAction',
    value: function dispatchAction(actionType, data) {
      console.log("Dispatching", actionType, JSON.stringify(data, false, 4), stackFrom());
      this.dispatch(_extends({
        actionType: actionType
      }, typeof data !== 'undefined' ? data : {}));
    }
  }, {
    key: 'onAction',
    value: function onAction(type, callback) {
      var _this = this;

      console.log("Registered handler", type, stackFrom());
      var id = this.register(function (_ref) {
        var actionType = _ref.actionType;

        var data = _objectWithoutProperties(_ref, ['actionType']);

        if (type == actionType) {
          console.log("Firing handler for ", type, stackFrom());
          callback(data);
        }
      });
      return {
        off: function off() {
          console.log("Unregister", type, stackFrom());
          _this.unregister(id);
        }
      };
    }
  }]);

  return Dispatcher;
})(_flux2['default'].Dispatcher);

exports['default'] = Dispatcher;
module.exports = exports['default'];

},{"flux":40}],62:[function(require,module,exports){
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

var _componentsRegisterView = require('../components/register-view');

var _componentsRegisterView2 = _interopRequireDefault(_componentsRegisterView);

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
      '/register': [this.unauthed, this.register],
      '/logout': [this.authed, this.logout]
    });
    this.router.init();
    var route = window.location.hash.slice(2);
    this.router.setRoute(route);
    _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.SET_ROUTE, function (data) {
      return _this.router.setRoute(data.route);
    });
    _storesAuth2['default'].onAction('update', function (state) {
      return _this.router.setRoute(state.token ? '/' : '/login');
    });
  }

  _createClass(Application, [{
    key: 'start',
    value: function start() {}
  }, {
    key: 'authed',
    value: function authed() {
      if (!_storesAuth2['default'].isAuthenticated()) {
        console.log("UnAuthed: redirecting to /login");
        this.setRoute('/login');
      }
    }
  }, {
    key: 'unauthed',
    value: function unauthed() {
      if (_storesAuth2['default'].isAuthenticated()) {
        _coreDispatcher2['default'].dispatch({
          actionType: _coreConstants.ACTIONS.LOGOUT
        });
      }
    }
  }, {
    key: 'app',
    value: function app() {
      _coreDispatcher2['default'].dispatch({
        actionType: _coreConstants.ACTIONS.SYNC_DOCUMENTS
      });
      _coreDispatcher2['default'].dispatch({
        actionType: _coreConstants.ACTIONS.SET_VIEW,
        view: _componentsAppView2['default']
      });
    }
  }, {
    key: 'login',
    value: function login() {
      _coreDispatcher2['default'].dispatch({
        actionType: _coreConstants.ACTIONS.SET_VIEW,
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
    key: 'register',
    value: function register() {
      _coreDispatcher2['default'].dispatch({
        actionType: _coreConstants.ACTIONS.SET_VIEW,
        view: _componentsRegisterView2['default']
      });
    }
  }]);

  return Application;
})();

exports['default'] = new Application();
module.exports = exports['default'];

},{"../components/app-view":51,"../components/layout":58,"../components/login-view":59,"../components/register-view":60,"../core/constants":63,"../core/dispatcher":64,"../stores/auth":70,"director":39}],63:[function(require,module,exports){
'use strict';

module.exports = {
  API_URL: 'http://localhost:5000',
  AUTH_DATA_KEY: 'authData',
  ACTIONS: {
    SET_VIEW: 'set_view',
    SET_ROUTE: 'set_route',
    LOGIN: 'login',
    LOGOUT: 'logout',
    REGISTER: 'register',
    SYNC_DOCUMENTS: 'sync_documents',
    CREATE_DOCUMENT: 'create_document',
    SAVE_DOCUMENT: 'save_document',
    REMOVE_DOCUMENT: 'remove_document',
    SELECT_DOCUMENT: 'select_document',
    ARCHIVE_DOCUMENT: 'archive_document',
    OPEN_IMPORT: 'open_import',
    PREVIEW_DOCUMENT: 'preview_document',
    FULLSCREEN_DOCUMENT: 'fullscreen_document '
  }
};

},{}],64:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _actionDispatcher = require('./action-dispatcher');

var _actionDispatcher2 = _interopRequireDefault(_actionDispatcher);

exports['default'] = new _actionDispatcher2['default']();
module.exports = exports['default'];

},{"./action-dispatcher":61}],65:[function(require,module,exports){
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

var ConflictError = (function (_NetworkError6) {
  _inherits(ConflictError, _NetworkError6);

  function ConflictError() {
    _classCallCheck(this, ConflictError);

    _get(Object.getPrototypeOf(ConflictError.prototype), 'constructor', this).call(this, 409, 'Conflict');
    this.name = 'ConflictError';
  }

  return ConflictError;
})(NetworkError);

exports.ConflictError = ConflictError;

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

      case 409:
        return new ConflictError();
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

},{}],66:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _constants = require('./constants');

var _storesAuth = require('../stores/auth');

var _storesAuth2 = _interopRequireDefault(_storesAuth);

var _axios = require('axios');

var _axios2 = _interopRequireDefault(_axios);

var _objectAssign = require('object-assign');

var _objectAssign2 = _interopRequireDefault(_objectAssign);

var _errors = require('./errors');

//
// HTTP Verbs
//

var iox = function iox(method) {
  return function (url) {
    var options = arguments.length <= 1 || arguments[1] === undefined ? {} : arguments[1];
    return function (data) {

      return (0, _axios2['default'])({
        url: '' + _constants.API_URL + url,
        data: data,
        options: options,
        method: method
      });
    };
  };
};

_axios2['default'].interceptors.request.use(function (req) {
  var _AuthStore$getState = _storesAuth2['default'].getState();

  var token = _AuthStore$getState.token;

  if (token) {
    req.headers = {
      Authorization: 'Token ' + token
    };
  }
  return req;
});
// Add a response interceptor
_axios2['default'].interceptors.response.use(function (res) {
  return res;
}, function (err) {
  return Promise.reject((0, _errors.errorFromXHR)(err));
});

exports['default'] = {
  get: iox('GET'),
  post: iox('POST'),
  put: iox('PUT'),
  'delete': iox('DELETE'),
  patch: iox('PATCH')
};
module.exports = exports['default'];

},{"../stores/auth":70,"./constants":63,"./errors":65,"axios":1,"object-assign":45}],67:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _extends = Object.assign || function (target) { for (var i = 1; i < arguments.length; i++) { var source = arguments[i]; for (var key in source) { if (Object.prototype.hasOwnProperty.call(source, key)) { target[key] = source[key]; } } } return target; };

var _createClass = (function () { function defineProperties(target, props) { for (var i = 0; i < props.length; i++) { var descriptor = props[i]; descriptor.enumerable = descriptor.enumerable || false; descriptor.configurable = true; if ('value' in descriptor) descriptor.writable = true; Object.defineProperty(target, descriptor.key, descriptor); } } return function (Constructor, protoProps, staticProps) { if (protoProps) defineProperties(Constructor.prototype, protoProps); if (staticProps) defineProperties(Constructor, staticProps); return Constructor; }; })();

var _get = function get(_x, _x2, _x3) { var _again = true; _function: while (_again) { var object = _x, property = _x2, receiver = _x3; desc = parent = getter = undefined; _again = false; if (object === null) object = Function.prototype; var desc = Object.getOwnPropertyDescriptor(object, property); if (desc === undefined) { var parent = Object.getPrototypeOf(object); if (parent === null) { return undefined; } else { _x = parent; _x2 = property; _x3 = receiver; _again = true; continue _function; } } else if ('value' in desc) { return desc.value; } else { var getter = desc.get; if (getter === undefined) { return undefined; } return getter.call(receiver); } } };

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _classCallCheck(instance, Constructor) { if (!(instance instanceof Constructor)) { throw new TypeError('Cannot call a class as a function'); } }

function _inherits(subClass, superClass) { if (typeof superClass !== 'function' && superClass !== null) { throw new TypeError('Super expression must either be null or a function, not ' + typeof superClass); } subClass.prototype = Object.create(superClass && superClass.prototype, { constructor: { value: subClass, enumerable: false, writable: true, configurable: true } }); if (superClass) Object.setPrototypeOf ? Object.setPrototypeOf(subClass, superClass) : subClass.__proto__ = superClass; }

var _coreActionDispatcher = require('../core/action-dispatcher');

var _coreActionDispatcher2 = _interopRequireDefault(_coreActionDispatcher);

var _objectAssign = require('object-assign');

var _objectAssign2 = _interopRequireDefault(_objectAssign);

var Store = (function (_ActionDispatcher) {
  _inherits(Store, _ActionDispatcher);

  function Store() {
    _classCallCheck(this, Store);

    _get(Object.getPrototypeOf(Store.prototype), 'constructor', this).call(this);
    this._state = {};
    this.setState(this.getInitialState());
  }

  _createClass(Store, [{
    key: 'getInitialState',
    value: function getInitialState() {
      return {};
    }
  }, {
    key: 'getState',
    value: function getState() {
      return this._state;
    }
  }, {
    key: 'setState',
    value: function setState(applyState) {
      this._state = (0, _objectAssign2['default'])(this._state, applyState);
      this.dispatch(_extends({
        actionType: "update"
      }, this._state));
      console.log("state", this._state);
    }
  }]);

  return Store;
})(_coreActionDispatcher2['default']);

exports['default'] = Store;
module.exports = exports['default'];

},{"../core/action-dispatcher":61,"object-assign":45}],68:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

var _templateObject = _taggedTemplateLiteral(['/auth/login'], ['/auth/login']),
    _templateObject2 = _taggedTemplateLiteral(['/auth/register'], ['/auth/register']);

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

function _taggedTemplateLiteral(strings, raw) { return Object.freeze(Object.defineProperties(strings, { raw: { value: Object.freeze(raw) } })); }

var _coreHttp = require('../core/http');

var _coreHttp2 = _interopRequireDefault(_coreHttp);

exports['default'] = {
  login: _coreHttp2['default'].post(_templateObject),
  register: _coreHttp2['default'].post(_templateObject2)
};
module.exports = exports['default'];

},{"../core/http":66}],69:[function(require,module,exports){
'use strict';

Object.defineProperty(exports, '__esModule', {
  value: true
});

function _interopRequireDefault(obj) { return obj && obj.__esModule ? obj : { 'default': obj }; }

var _coreHttp = require('../core/http');

var _coreHttp2 = _interopRequireDefault(_coreHttp);

exports['default'] = {
  sync: _coreHttp2['default'].get('/api/documents'),
  fetch: function fetch(id) {
    return _coreHttp2['default'].get('/api/documents/' + id)();
  },
  create: function create(data) {
    return _coreHttp2['default'].post('/api/documents')(data);
  },
  update: function update(id, data) {
    return _coreHttp2['default'].put('/api/documents/' + id)(data);
  },
  'delete': function _delete(id) {
    return _coreHttp2['default']['delete']('/api/documents/' + id)();
  }
};
module.exports = exports['default'];

},{"../core/http":66}],70:[function(require,module,exports){
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

var _coreErrors = require('../core/errors');

var _coreStore = require('../core/store');

var _coreStore2 = _interopRequireDefault(_coreStore);

var _httpAuth = require('../http/auth');

var _httpAuth2 = _interopRequireDefault(_httpAuth);

var _coreDispatcher = require('../core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var AuthStore = (function (_Store) {
  _inherits(AuthStore, _Store);

  function AuthStore() {
    var _this = this;

    _classCallCheck(this, AuthStore);

    _get(Object.getPrototypeOf(AuthStore.prototype), 'constructor', this).call(this);
    _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.LOGIN, function (data) {
      return _this.loginAction(data);
    });
    _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.REGISTER, function (data) {
      return _this.registerAction(data);
    });
    _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.LOGOUT, function () {
      return _this.logoutAction();
    });
  }

  _createClass(AuthStore, [{
    key: 'getInitialState',
    value: function getInitialState() {
      var _ref = JSON.parse(sessionStorage.getItem(_coreConstants.AUTH_DATA_KEY)) || {};

      var _ref$token = _ref.token;
      var token = _ref$token === undefined ? null : _ref$token;
      var _ref$user = _ref.user;
      var user = _ref$user === undefined ? null : _ref$user;

      return { token: token, user: user };
    }
  }, {
    key: 'setAuth',
    value: function setAuth(data) {
      this.setState({
        token: data.token,
        user: data.user
      });
      sessionStorage.setItem(_coreConstants.AUTH_DATA_KEY, JSON.stringify(data));
    }
  }, {
    key: 'clearAuth',
    value: function clearAuth() {
      this.setState({
        token: null,
        user: null
      });
      sessionStorage.removeItem(_coreConstants.AUTH_DATA_KEY);
    }
  }, {
    key: 'isAuthenticated',
    value: function isAuthenticated() {
      var _getState = this.getState();

      var token = _getState.token;
      var user = _getState.user;

      console.log(token, user);
      if (token != null) return true;
      return false;
    }
  }, {
    key: 'loginAction',
    value: function loginAction(data) {
      var res;
      return regeneratorRuntime.async(function loginAction$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            context$2$0.prev = 0;

            console.log(data);
            context$2$0.next = 4;
            return regeneratorRuntime.awrap(_httpAuth2['default'].login(data));

          case 4:
            res = context$2$0.sent;

            this.setAuth({
              token: res.data.access_token
            });
            this.dispatch('login:success');
            context$2$0.next = 13;
            break;

          case 9:
            context$2$0.prev = 9;
            context$2$0.t0 = context$2$0['catch'](0);

            if (context$2$0.t0 instanceof _coreErrors.UnauthorizedError) {
              this.dispatch({ actionType: 'login:failure', error: "Incorrect username or password" });
            } else if (context$2$0.t0 instanceof _coreErrors.ForbiddenError) {
              this.dispatch({ actionType: 'login:activate' });
            } else if (context$2$0.t0 instanceof _coreErrors.NotFoundError) {
              this.dispatch({ actionType: 'login:failure', error: "Incorrect username or password" });
            } else {}
            console.error(context$2$0.t0.stack);

          case 13:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this, [[0, 9]]);
    }
  }, {
    key: 'registerAction',
    value: function registerAction(data) {
      var res;
      return regeneratorRuntime.async(function registerAction$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            context$2$0.prev = 0;

            console.log(data);
            context$2$0.next = 4;
            return regeneratorRuntime.awrap(_httpAuth2['default'].register(data));

          case 4:
            res = context$2$0.sent;

            this.setAuth(res.data);
            this.dispatch('login:success');
            context$2$0.next = 12;
            break;

          case 9:
            context$2$0.prev = 9;
            context$2$0.t0 = context$2$0['catch'](0);

            if (context$2$0.t0 instanceof _coreErrors.ConflictError) {
              this.dispatch({ actionType: 'register:failure', error: "That account already exists" });
            } else {
              this.dispatch({ actionType: 'register:failure', error: context$2$0.t0.Error });
            }

          case 12:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this, [[0, 9]]);
    }
  }, {
    key: 'logoutAction',
    value: function logoutAction() {
      this.clearAuth();
      this.dispatch('logout:success');
    }
  }]);

  return AuthStore;
})(_coreStore2['default']);

exports['default'] = new AuthStore();
module.exports = exports['default'];

},{"../core/constants":63,"../core/dispatcher":64,"../core/errors":65,"../core/store":67,"../http/auth":68}],71:[function(require,module,exports){
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

var _coreStore = require('../core/store');

var _coreStore2 = _interopRequireDefault(_coreStore);

var _httpDocuments = require('../http/documents');

var _httpDocuments2 = _interopRequireDefault(_httpDocuments);

var _coreDispatcher = require('../core/dispatcher');

var _coreDispatcher2 = _interopRequireDefault(_coreDispatcher);

var DocumentStore = (function (_Store) {
  _inherits(DocumentStore, _Store);

  function DocumentStore() {
    var _this = this;

    _classCallCheck(this, DocumentStore);

    _get(Object.getPrototypeOf(DocumentStore.prototype), 'constructor', this).call(this);
    _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.SYNC_DOCUMENTS, function () {
      return _this.sync();
    });
    _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.SELECT_DOCUMENT, function (data) {
      return _this.select(data);
    });
    _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.CREATE_DOCUMENT, function () {
      return _this.create();
    });
    _coreDispatcher2['default'].onAction(_coreConstants.ACTIONS.REMOVE_DOCUMENT, function () {
      return _this.remove();
    });
  }

  _createClass(DocumentStore, [{
    key: 'getInitialState',
    value: function getInitialState() {
      return {
        documents: [],
        selected: null
      };
    }
  }, {
    key: 'create',
    value: function create() {
      var _ref, data;

      return regeneratorRuntime.async(function create$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            context$2$0.prev = 0;
            context$2$0.next = 3;
            return regeneratorRuntime.awrap(_httpDocuments2['default'].create({
              body: "# Untitled"
            }));

          case 3:
            _ref = context$2$0.sent;
            data = _ref.data;
            context$2$0.next = 7;
            return regeneratorRuntime.awrap(this.sync());

          case 7:
            this.select(data);
            context$2$0.next = 13;
            break;

          case 10:
            context$2$0.prev = 10;
            context$2$0.t0 = context$2$0['catch'](0);

            this.dispatch({
              actionType: 'create:failure'
            });

          case 13:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this, [[0, 10]]);
    }
  }, {
    key: 'remove',
    value: function remove() {
      var _ref2, data;

      return regeneratorRuntime.async(function remove$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            context$2$0.prev = 0;
            context$2$0.next = 3;
            return regeneratorRuntime.awrap(_httpDocuments2['default']['delete'](this.getState().selected.id));

          case 3:
            _ref2 = context$2$0.sent;
            data = _ref2.data;
            context$2$0.next = 7;
            return regeneratorRuntime.awrap(this.sync());

          case 7:
            this.select(this.getState().documents[0]);
            context$2$0.next = 13;
            break;

          case 10:
            context$2$0.prev = 10;
            context$2$0.t0 = context$2$0['catch'](0);

            this.dispatch({
              actionType: 'create:failure'
            });

          case 13:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this, [[0, 10]]);
    }
  }, {
    key: 'sync',
    value: function sync() {
      var _ref3, data;

      return regeneratorRuntime.async(function sync$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            context$2$0.prev = 0;
            context$2$0.next = 3;
            return regeneratorRuntime.awrap(_httpDocuments2['default'].sync());

          case 3:
            _ref3 = context$2$0.sent;
            data = _ref3.data;

            this.setState({
              documents: data
            });
            context$2$0.next = 11;
            break;

          case 8:
            context$2$0.prev = 8;
            context$2$0.t0 = context$2$0['catch'](0);

            this.dispatch({
              actionType: 'sync:failure'
            });

          case 11:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this, [[0, 8]]);
    }
  }, {
    key: 'select',
    value: function select(_ref4) {
      var id = _ref4.id;

      var _ref5, data;

      return regeneratorRuntime.async(function select$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            context$2$0.prev = 0;
            context$2$0.next = 3;
            return regeneratorRuntime.awrap(_httpDocuments2['default'].fetch(id));

          case 3:
            _ref5 = context$2$0.sent;
            data = _ref5.data;

            this.setState({
              selected: data
            });
            context$2$0.next = 8;
            return regeneratorRuntime.awrap(this.sync());

          case 8:
            context$2$0.next = 13;
            break;

          case 10:
            context$2$0.prev = 10;
            context$2$0.t0 = context$2$0['catch'](0);

            this.dispatch({
              actionType: 'select:failure'
            });

          case 13:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this, [[0, 10]]);
    }
  }, {
    key: 'save',
    value: function save(id, data) {
      var res;
      return regeneratorRuntime.async(function save$(context$2$0) {
        while (1) switch (context$2$0.prev = context$2$0.next) {
          case 0:
            context$2$0.prev = 0;
            context$2$0.next = 3;
            return regeneratorRuntime.awrap(_httpDocuments2['default'].update(id, data));

          case 3:
            res = context$2$0.sent;
            context$2$0.next = 9;
            break;

          case 6:
            context$2$0.prev = 6;
            context$2$0.t0 = context$2$0['catch'](0);

            this.dispatch({
              actionType: 'save:failure'
            });

          case 9:
          case 'end':
            return context$2$0.stop();
        }
      }, null, this, [[0, 6]]);
    }
  }]);

  return DocumentStore;
})(_coreStore2['default']);

exports['default'] = new DocumentStore();
module.exports = exports['default'];

},{"../core/constants":63,"../core/dispatcher":64,"../core/store":67,"../http/documents":69}],72:[function(require,module,exports){
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
  : typedArraySupport()

function typedArraySupport () {
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
}

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
  this[offset] = (value & 0xff)
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
    this[offset] = (value & 0xff)
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
    this[offset + 1] = (value & 0xff)
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
    this[offset] = (value & 0xff)
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
    this[offset + 3] = (value & 0xff)
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
  this[offset] = (value & 0xff)
  return offset + 1
}

Buffer.prototype.writeInt16LE = function writeInt16LE (value, offset, noAssert) {
  value = +value
  offset = offset | 0
  if (!noAssert) checkInt(this, value, offset, 2, 0x7fff, -0x8000)
  if (Buffer.TYPED_ARRAY_SUPPORT) {
    this[offset] = (value & 0xff)
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
    this[offset + 1] = (value & 0xff)
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
    this[offset] = (value & 0xff)
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
    this[offset + 3] = (value & 0xff)
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

},{"base64-js":73,"ieee754":74,"is-array":75}],73:[function(require,module,exports){
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

},{}],74:[function(require,module,exports){
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

},{}],75:[function(require,module,exports){

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

},{}],76:[function(require,module,exports){
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

},{}]},{},[50])
//# sourceMappingURL=data:application/json;charset:utf-8;base64,eyJ2ZXJzaW9uIjozLCJzb3VyY2VzIjpbIi4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL2Jyb3dzZXItcGFjay9fcHJlbHVkZS5qcyIsIm5vZGVfbW9kdWxlcy9heGlvcy9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9heGlvcy9saWIvYWRhcHRlcnMveGhyLmpzIiwibm9kZV9tb2R1bGVzL2F4aW9zL2xpYi9heGlvcy5qcyIsIm5vZGVfbW9kdWxlcy9heGlvcy9saWIvY29yZS9JbnRlcmNlcHRvck1hbmFnZXIuanMiLCJub2RlX21vZHVsZXMvYXhpb3MvbGliL2NvcmUvZGlzcGF0Y2hSZXF1ZXN0LmpzIiwibm9kZV9tb2R1bGVzL2F4aW9zL2xpYi9kZWZhdWx0cy5qcyIsIm5vZGVfbW9kdWxlcy9heGlvcy9saWIvaGVscGVycy9idWlsZFVybC5qcyIsIm5vZGVfbW9kdWxlcy9heGlvcy9saWIvaGVscGVycy9jb29raWVzLmpzIiwibm9kZV9tb2R1bGVzL2F4aW9zL2xpYi9oZWxwZXJzL3BhcnNlSGVhZGVycy5qcyIsIm5vZGVfbW9kdWxlcy9heGlvcy9saWIvaGVscGVycy9zcHJlYWQuanMiLCJub2RlX21vZHVsZXMvYXhpb3MvbGliL2hlbHBlcnMvdHJhbnNmb3JtRGF0YS5qcyIsIm5vZGVfbW9kdWxlcy9heGlvcy9saWIvaGVscGVycy91cmxJc1NhbWVPcmlnaW4uanMiLCJub2RlX21vZHVsZXMvYXhpb3MvbGliL3V0aWxzLmpzIiwibm9kZV9tb2R1bGVzL2Rla3UvbGliL2FwcGxpY2F0aW9uLmpzIiwibm9kZV9tb2R1bGVzL2Rla3UvbGliL2V2ZW50cy5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L2xpYi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L2xpYi9ub2RlLXR5cGUuanMiLCJub2RlX21vZHVsZXMvZGVrdS9saWIvcmVuZGVyLmpzIiwibm9kZV9tb2R1bGVzL2Rla3UvbGliL3N0cmluZ2lmeS5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L2xpYi9zdmcuanMiLCJub2RlX21vZHVsZXMvZGVrdS9ub2RlX21vZHVsZXMvY29tcG9uZW50LWVtaXR0ZXIvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZGVrdS9ub2RlX21vZHVsZXMvY29tcG9uZW50LXJhZi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L25vZGVfbW9kdWxlcy9jb21wb25lbnQtdHlwZS9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L25vZGVfbW9kdWxlcy9mYXN0LmpzL2FycmF5L2ZvckVhY2guanMiLCJub2RlX21vZHVsZXMvZGVrdS9ub2RlX21vZHVsZXMvZmFzdC5qcy9hcnJheS9yZWR1Y2UuanMiLCJub2RlX21vZHVsZXMvZGVrdS9ub2RlX21vZHVsZXMvZmFzdC5qcy9mb3JFYWNoLmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2Zhc3QuanMvZnVuY3Rpb24vYmluZEludGVybmFsMy5qcyIsIm5vZGVfbW9kdWxlcy9kZWt1L25vZGVfbW9kdWxlcy9mYXN0LmpzL2Z1bmN0aW9uL2JpbmRJbnRlcm5hbDQuanMiLCJub2RlX21vZHVsZXMvZGVrdS9ub2RlX21vZHVsZXMvZmFzdC5qcy9vYmplY3QvYXNzaWduLmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2Zhc3QuanMvb2JqZWN0L2ZvckVhY2guanMiLCJub2RlX21vZHVsZXMvZGVrdS9ub2RlX21vZHVsZXMvZmFzdC5qcy9vYmplY3QvcmVkdWNlLmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2Zhc3QuanMvcmVkdWNlLmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2dldC11aWQvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZGVrdS9ub2RlX21vZHVsZXMvaXMtZG9tL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL2lzLXN2Zy1hdHRyaWJ1dGUvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZGVrdS9ub2RlX21vZHVsZXMvaXMtc3ZnLWVsZW1lbnQvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZGVrdS9ub2RlX21vZHVsZXMvb2JqZWN0LWRlZmF1bHRzL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2Rla3Uvbm9kZV9tb2R1bGVzL29iamVjdC1wYXRoL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2RpcmVjdG9yL2J1aWxkL2RpcmVjdG9yLmpzIiwibm9kZV9tb2R1bGVzL2ZsdXgvaW5kZXguanMiLCJub2RlX21vZHVsZXMvZmx1eC9saWIvRGlzcGF0Y2hlci5qcyIsIm5vZGVfbW9kdWxlcy9mbHV4L25vZGVfbW9kdWxlcy9mYmpzL2xpYi9pbnZhcmlhbnQuanMiLCJub2RlX21vZHVsZXMvbG9kYXNoLmRlYm91bmNlL2luZGV4LmpzIiwibm9kZV9tb2R1bGVzL2xvZGFzaC5kZWJvdW5jZS9ub2RlX21vZHVsZXMvbG9kYXNoLl9nZXRuYXRpdmUvaW5kZXguanMiLCJub2RlX21vZHVsZXMvb2JqZWN0LWFzc2lnbi9pbmRleC5qcyIsIm5vZGVfbW9kdWxlcy92aXJ0dWFsLWVsZW1lbnQvaW5kZXguanMiLCJub2RlX21vZHVsZXMvdmlydHVhbC1lbGVtZW50L25vZGVfbW9kdWxlcy9hcnJheS1mbGF0dGVuL2FycmF5LWZsYXR0ZW4uanMiLCJub2RlX21vZHVsZXMvdmlydHVhbC1lbGVtZW50L25vZGVfbW9kdWxlcy9zbGljZWQvaW5kZXguanMiLCJub2RlX21vZHVsZXMvdmlydHVhbC1lbGVtZW50L25vZGVfbW9kdWxlcy9zbGljZWQvbGliL3NsaWNlZC5qcyIsIi9zcmMvYXBwL3NyYy9hcHAuanMiLCIvc3JjL2FwcC9zcmMvY29tcG9uZW50cy9hcHAtdmlldy5qcyIsIi9zcmMvYXBwL3NyYy9jb21wb25lbnRzL2RvYy1lZGl0b3IuanMiLCIvc3JjL2FwcC9zcmMvY29tcG9uZW50cy9kb2MtbGlzdC5qcyIsIi9zcmMvYXBwL3NyYy9jb21wb25lbnRzL2RvYy10b29sYmFyLmpzIiwiL3NyYy9hcHAvc3JjL2NvbXBvbmVudHMvZHJvcGRvd24uanMiLCIvc3JjL2FwcC9zcmMvY29tcG9uZW50cy9mb3JrbWUuanMiLCIvc3JjL2FwcC9zcmMvY29tcG9uZW50cy9pbXBvcnQuanMiLCIvc3JjL2FwcC9zcmMvY29tcG9uZW50cy9sYXlvdXQuanMiLCIvc3JjL2FwcC9zcmMvY29tcG9uZW50cy9sb2dpbi12aWV3LmpzIiwiL3NyYy9hcHAvc3JjL2NvbXBvbmVudHMvcmVnaXN0ZXItdmlldy5qcyIsIi9zcmMvYXBwL3NyYy9jb3JlL2FjdGlvbi1kaXNwYXRjaGVyLmpzIiwiL3NyYy9hcHAvc3JjL2NvcmUvYXBwbGljYXRpb24uanMiLCIvc3JjL2FwcC9zcmMvY29yZS9jb25zdGFudHMuanMiLCIvc3JjL2FwcC9zcmMvY29yZS9kaXNwYXRjaGVyLmpzIiwiL3NyYy9hcHAvc3JjL2NvcmUvZXJyb3JzLmpzIiwiL3NyYy9hcHAvc3JjL2NvcmUvaHR0cC5qcyIsIi9zcmMvYXBwL3NyYy9jb3JlL3N0b3JlLmpzIiwiL3NyYy9hcHAvc3JjL2h0dHAvYXV0aC5qcyIsIi9zcmMvYXBwL3NyYy9odHRwL2RvY3VtZW50cy5qcyIsIi9zcmMvYXBwL3NyYy9zdG9yZXMvYXV0aC5qcyIsIi9zcmMvYXBwL3NyYy9zdG9yZXMvZG9jdW1lbnQuanMiLCIuLi8uLi91c3IvbG9jYWwvbGliL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvaW5kZXguanMiLCIuLi8uLi91c3IvbG9jYWwvbGliL25vZGVfbW9kdWxlcy9icm93c2VyaWZ5L25vZGVfbW9kdWxlcy9idWZmZXIvbm9kZV9tb2R1bGVzL2Jhc2U2NC1qcy9saWIvYjY0LmpzIiwiLi4vLi4vdXNyL2xvY2FsL2xpYi9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pZWVlNzU0L2luZGV4LmpzIiwiLi4vLi4vdXNyL2xvY2FsL2xpYi9ub2RlX21vZHVsZXMvYnJvd3NlcmlmeS9ub2RlX21vZHVsZXMvYnVmZmVyL25vZGVfbW9kdWxlcy9pcy1hcnJheS9pbmRleC5qcyIsIi4uLy4uL3Vzci9sb2NhbC9saWIvbm9kZV9tb2R1bGVzL2Jyb3dzZXJpZnkvbm9kZV9tb2R1bGVzL3Byb2Nlc3MvYnJvd3Nlci5qcyJdLCJuYW1lcyI6W10sIm1hcHBpbmdzIjoiQUFBQTtBQ0FBOztBQ0FBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwSEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN4RkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7O0FDcERBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7OztBQzFCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDOURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMzQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0JBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDbkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMURBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3pQQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JGQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDNUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNoQkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUMxeENBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BJQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDTEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ2pLQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7QUNsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNwQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNuQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDckJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNYQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDWEE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNsQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3ZCQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3JDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNMQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNmQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDM0RBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQ3BDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN0UkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwdEJBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7OztBQ1ZBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7Ozs7QUN0T0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7Ozs7QUNoREE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDMU9BO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUN6SUE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDdkNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FB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O0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOzs7O0FDeGdEQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBOztBQzVIQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTs7QUNwRkE7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7O0FDakNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0E7QUFDQTtBQUNBO0FBQ0EiLCJmaWxlIjoiZ2VuZXJhdGVkLmpzIiwic291cmNlUm9vdCI6IiIsInNvdXJjZXNDb250ZW50IjpbIihmdW5jdGlvbiBlKHQsbixyKXtmdW5jdGlvbiBzKG8sdSl7aWYoIW5bb10pe2lmKCF0W29dKXt2YXIgYT10eXBlb2YgcmVxdWlyZT09XCJmdW5jdGlvblwiJiZyZXF1aXJlO2lmKCF1JiZhKXJldHVybiBhKG8sITApO2lmKGkpcmV0dXJuIGkobywhMCk7dmFyIGY9bmV3IEVycm9yKFwiQ2Fubm90IGZpbmQgbW9kdWxlICdcIitvK1wiJ1wiKTt0aHJvdyBmLmNvZGU9XCJNT0RVTEVfTk9UX0ZPVU5EXCIsZn12YXIgbD1uW29dPXtleHBvcnRzOnt9fTt0W29dWzBdLmNhbGwobC5leHBvcnRzLGZ1bmN0aW9uKGUpe3ZhciBuPXRbb11bMV1bZV07cmV0dXJuIHMobj9uOmUpfSxsLGwuZXhwb3J0cyxlLHQsbixyKX1yZXR1cm4gbltvXS5leHBvcnRzfXZhciBpPXR5cGVvZiByZXF1aXJlPT1cImZ1bmN0aW9uXCImJnJlcXVpcmU7Zm9yKHZhciBvPTA7bzxyLmxlbmd0aDtvKyspcyhyW29dKTtyZXR1cm4gc30pIiwibW9kdWxlLmV4cG9ydHMgPSByZXF1aXJlKCcuL2xpYi9heGlvcycpOyIsIid1c2Ugc3RyaWN0JztcblxuLypnbG9iYWwgQWN0aXZlWE9iamVjdDp0cnVlKi9cblxudmFyIGRlZmF1bHRzID0gcmVxdWlyZSgnLi8uLi9kZWZhdWx0cycpO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi8uLi91dGlscycpO1xudmFyIGJ1aWxkVXJsID0gcmVxdWlyZSgnLi8uLi9oZWxwZXJzL2J1aWxkVXJsJyk7XG52YXIgcGFyc2VIZWFkZXJzID0gcmVxdWlyZSgnLi8uLi9oZWxwZXJzL3BhcnNlSGVhZGVycycpO1xudmFyIHRyYW5zZm9ybURhdGEgPSByZXF1aXJlKCcuLy4uL2hlbHBlcnMvdHJhbnNmb3JtRGF0YScpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIHhockFkYXB0ZXIocmVzb2x2ZSwgcmVqZWN0LCBjb25maWcpIHtcbiAgLy8gVHJhbnNmb3JtIHJlcXVlc3QgZGF0YVxuICB2YXIgZGF0YSA9IHRyYW5zZm9ybURhdGEoXG4gICAgY29uZmlnLmRhdGEsXG4gICAgY29uZmlnLmhlYWRlcnMsXG4gICAgY29uZmlnLnRyYW5zZm9ybVJlcXVlc3RcbiAgKTtcblxuICAvLyBNZXJnZSBoZWFkZXJzXG4gIHZhciByZXF1ZXN0SGVhZGVycyA9IHV0aWxzLm1lcmdlKFxuICAgIGRlZmF1bHRzLmhlYWRlcnMuY29tbW9uLFxuICAgIGRlZmF1bHRzLmhlYWRlcnNbY29uZmlnLm1ldGhvZF0gfHwge30sXG4gICAgY29uZmlnLmhlYWRlcnMgfHwge31cbiAgKTtcblxuICBpZiAodXRpbHMuaXNGb3JtRGF0YShkYXRhKSkge1xuICAgIGRlbGV0ZSByZXF1ZXN0SGVhZGVyc1snQ29udGVudC1UeXBlJ107IC8vIExldCB0aGUgYnJvd3NlciBzZXQgaXRcbiAgfVxuXG4gIC8vIENyZWF0ZSB0aGUgcmVxdWVzdFxuICB2YXIgcmVxdWVzdCA9IG5ldyAoWE1MSHR0cFJlcXVlc3QgfHwgQWN0aXZlWE9iamVjdCkoJ01pY3Jvc29mdC5YTUxIVFRQJyk7XG4gIHJlcXVlc3Qub3Blbihjb25maWcubWV0aG9kLnRvVXBwZXJDYXNlKCksIGJ1aWxkVXJsKGNvbmZpZy51cmwsIGNvbmZpZy5wYXJhbXMpLCB0cnVlKTtcblxuICAvLyBTZXQgdGhlIHJlcXVlc3QgdGltZW91dCBpbiBNU1xuICByZXF1ZXN0LnRpbWVvdXQgPSBjb25maWcudGltZW91dDtcblxuICAvLyBMaXN0ZW4gZm9yIHJlYWR5IHN0YXRlXG4gIHJlcXVlc3Qub25yZWFkeXN0YXRlY2hhbmdlID0gZnVuY3Rpb24gKCkge1xuICAgIGlmIChyZXF1ZXN0ICYmIHJlcXVlc3QucmVhZHlTdGF0ZSA9PT0gNCkge1xuICAgICAgLy8gUHJlcGFyZSB0aGUgcmVzcG9uc2VcbiAgICAgIHZhciByZXNwb25zZUhlYWRlcnMgPSBwYXJzZUhlYWRlcnMocmVxdWVzdC5nZXRBbGxSZXNwb25zZUhlYWRlcnMoKSk7XG4gICAgICB2YXIgcmVzcG9uc2VEYXRhID0gWyd0ZXh0JywgJyddLmluZGV4T2YoY29uZmlnLnJlc3BvbnNlVHlwZSB8fCAnJykgIT09IC0xID8gcmVxdWVzdC5yZXNwb25zZVRleHQgOiByZXF1ZXN0LnJlc3BvbnNlO1xuICAgICAgdmFyIHJlc3BvbnNlID0ge1xuICAgICAgICBkYXRhOiB0cmFuc2Zvcm1EYXRhKFxuICAgICAgICAgIHJlc3BvbnNlRGF0YSxcbiAgICAgICAgICByZXNwb25zZUhlYWRlcnMsXG4gICAgICAgICAgY29uZmlnLnRyYW5zZm9ybVJlc3BvbnNlXG4gICAgICAgICksXG4gICAgICAgIHN0YXR1czogcmVxdWVzdC5zdGF0dXMsXG4gICAgICAgIHN0YXR1c1RleHQ6IHJlcXVlc3Quc3RhdHVzVGV4dCxcbiAgICAgICAgaGVhZGVyczogcmVzcG9uc2VIZWFkZXJzLFxuICAgICAgICBjb25maWc6IGNvbmZpZ1xuICAgICAgfTtcblxuICAgICAgLy8gUmVzb2x2ZSBvciByZWplY3QgdGhlIFByb21pc2UgYmFzZWQgb24gdGhlIHN0YXR1c1xuICAgICAgKHJlcXVlc3Quc3RhdHVzID49IDIwMCAmJiByZXF1ZXN0LnN0YXR1cyA8IDMwMCA/XG4gICAgICAgIHJlc29sdmUgOlxuICAgICAgICByZWplY3QpKHJlc3BvbnNlKTtcblxuICAgICAgLy8gQ2xlYW4gdXAgcmVxdWVzdFxuICAgICAgcmVxdWVzdCA9IG51bGw7XG4gICAgfVxuICB9O1xuXG4gIC8vIEFkZCB4c3JmIGhlYWRlclxuICAvLyBUaGlzIGlzIG9ubHkgZG9uZSBpZiBydW5uaW5nIGluIGEgc3RhbmRhcmQgYnJvd3NlciBlbnZpcm9ubWVudC5cbiAgLy8gU3BlY2lmaWNhbGx5IG5vdCBpZiB3ZSdyZSBpbiBhIHdlYiB3b3JrZXIsIG9yIHJlYWN0LW5hdGl2ZS5cbiAgaWYgKHV0aWxzLmlzU3RhbmRhcmRCcm93c2VyRW52KCkpIHtcbiAgICB2YXIgY29va2llcyA9IHJlcXVpcmUoJy4vLi4vaGVscGVycy9jb29raWVzJyk7XG4gICAgdmFyIHVybElzU2FtZU9yaWdpbiA9IHJlcXVpcmUoJy4vLi4vaGVscGVycy91cmxJc1NhbWVPcmlnaW4nKTtcblxuICAgIC8vIEFkZCB4c3JmIGhlYWRlclxuICAgIHZhciB4c3JmVmFsdWUgPSB1cmxJc1NhbWVPcmlnaW4oY29uZmlnLnVybCkgP1xuICAgICAgICBjb29raWVzLnJlYWQoY29uZmlnLnhzcmZDb29raWVOYW1lIHx8IGRlZmF1bHRzLnhzcmZDb29raWVOYW1lKSA6XG4gICAgICAgIHVuZGVmaW5lZDtcblxuICAgIGlmICh4c3JmVmFsdWUpIHtcbiAgICAgIHJlcXVlc3RIZWFkZXJzW2NvbmZpZy54c3JmSGVhZGVyTmFtZSB8fCBkZWZhdWx0cy54c3JmSGVhZGVyTmFtZV0gPSB4c3JmVmFsdWU7XG4gICAgfVxuICB9XG5cbiAgLy8gQWRkIGhlYWRlcnMgdG8gdGhlIHJlcXVlc3RcbiAgdXRpbHMuZm9yRWFjaChyZXF1ZXN0SGVhZGVycywgZnVuY3Rpb24gKHZhbCwga2V5KSB7XG4gICAgLy8gUmVtb3ZlIENvbnRlbnQtVHlwZSBpZiBkYXRhIGlzIHVuZGVmaW5lZFxuICAgIGlmICghZGF0YSAmJiBrZXkudG9Mb3dlckNhc2UoKSA9PT0gJ2NvbnRlbnQtdHlwZScpIHtcbiAgICAgIGRlbGV0ZSByZXF1ZXN0SGVhZGVyc1trZXldO1xuICAgIH1cbiAgICAvLyBPdGhlcndpc2UgYWRkIGhlYWRlciB0byB0aGUgcmVxdWVzdFxuICAgIGVsc2Uge1xuICAgICAgcmVxdWVzdC5zZXRSZXF1ZXN0SGVhZGVyKGtleSwgdmFsKTtcbiAgICB9XG4gIH0pO1xuXG4gIC8vIEFkZCB3aXRoQ3JlZGVudGlhbHMgdG8gcmVxdWVzdCBpZiBuZWVkZWRcbiAgaWYgKGNvbmZpZy53aXRoQ3JlZGVudGlhbHMpIHtcbiAgICByZXF1ZXN0LndpdGhDcmVkZW50aWFscyA9IHRydWU7XG4gIH1cblxuICAvLyBBZGQgcmVzcG9uc2VUeXBlIHRvIHJlcXVlc3QgaWYgbmVlZGVkXG4gIGlmIChjb25maWcucmVzcG9uc2VUeXBlKSB7XG4gICAgdHJ5IHtcbiAgICAgIHJlcXVlc3QucmVzcG9uc2VUeXBlID0gY29uZmlnLnJlc3BvbnNlVHlwZTtcbiAgICB9IGNhdGNoIChlKSB7XG4gICAgICBpZiAocmVxdWVzdC5yZXNwb25zZVR5cGUgIT09ICdqc29uJykge1xuICAgICAgICB0aHJvdyBlO1xuICAgICAgfVxuICAgIH1cbiAgfVxuXG4gIGlmICh1dGlscy5pc0FycmF5QnVmZmVyKGRhdGEpKSB7XG4gICAgZGF0YSA9IG5ldyBEYXRhVmlldyhkYXRhKTtcbiAgfVxuXG4gIC8vIFNlbmQgdGhlIHJlcXVlc3RcbiAgcmVxdWVzdC5zZW5kKGRhdGEpO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGRlZmF1bHRzID0gcmVxdWlyZSgnLi9kZWZhdWx0cycpO1xudmFyIHV0aWxzID0gcmVxdWlyZSgnLi91dGlscycpO1xudmFyIGRpc3BhdGNoUmVxdWVzdCA9IHJlcXVpcmUoJy4vY29yZS9kaXNwYXRjaFJlcXVlc3QnKTtcbnZhciBJbnRlcmNlcHRvck1hbmFnZXIgPSByZXF1aXJlKCcuL2NvcmUvSW50ZXJjZXB0b3JNYW5hZ2VyJyk7XG5cbnZhciBheGlvcyA9IG1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGNvbmZpZykge1xuICAvLyBBbGxvdyBmb3IgYXhpb3MoJ2V4YW1wbGUvdXJsJ1ssIGNvbmZpZ10pIGEgbGEgZmV0Y2ggQVBJXG4gIGlmICh0eXBlb2YgY29uZmlnID09PSAnc3RyaW5nJykge1xuICAgIGNvbmZpZyA9IHV0aWxzLm1lcmdlKHtcbiAgICAgIHVybDogYXJndW1lbnRzWzBdXG4gICAgfSwgYXJndW1lbnRzWzFdKTtcbiAgfVxuXG4gIGNvbmZpZyA9IHV0aWxzLm1lcmdlKHtcbiAgICBtZXRob2Q6ICdnZXQnLFxuICAgIGhlYWRlcnM6IHt9LFxuICAgIHRpbWVvdXQ6IGRlZmF1bHRzLnRpbWVvdXQsXG4gICAgdHJhbnNmb3JtUmVxdWVzdDogZGVmYXVsdHMudHJhbnNmb3JtUmVxdWVzdCxcbiAgICB0cmFuc2Zvcm1SZXNwb25zZTogZGVmYXVsdHMudHJhbnNmb3JtUmVzcG9uc2VcbiAgfSwgY29uZmlnKTtcblxuICAvLyBEb24ndCBhbGxvdyBvdmVycmlkaW5nIGRlZmF1bHRzLndpdGhDcmVkZW50aWFsc1xuICBjb25maWcud2l0aENyZWRlbnRpYWxzID0gY29uZmlnLndpdGhDcmVkZW50aWFscyB8fCBkZWZhdWx0cy53aXRoQ3JlZGVudGlhbHM7XG5cbiAgLy8gSG9vayB1cCBpbnRlcmNlcHRvcnMgbWlkZGxld2FyZVxuICB2YXIgY2hhaW4gPSBbZGlzcGF0Y2hSZXF1ZXN0LCB1bmRlZmluZWRdO1xuICB2YXIgcHJvbWlzZSA9IFByb21pc2UucmVzb2x2ZShjb25maWcpO1xuXG4gIGF4aW9zLmludGVyY2VwdG9ycy5yZXF1ZXN0LmZvckVhY2goZnVuY3Rpb24gKGludGVyY2VwdG9yKSB7XG4gICAgY2hhaW4udW5zaGlmdChpbnRlcmNlcHRvci5mdWxmaWxsZWQsIGludGVyY2VwdG9yLnJlamVjdGVkKTtcbiAgfSk7XG5cbiAgYXhpb3MuaW50ZXJjZXB0b3JzLnJlc3BvbnNlLmZvckVhY2goZnVuY3Rpb24gKGludGVyY2VwdG9yKSB7XG4gICAgY2hhaW4ucHVzaChpbnRlcmNlcHRvci5mdWxmaWxsZWQsIGludGVyY2VwdG9yLnJlamVjdGVkKTtcbiAgfSk7XG5cbiAgd2hpbGUgKGNoYWluLmxlbmd0aCkge1xuICAgIHByb21pc2UgPSBwcm9taXNlLnRoZW4oY2hhaW4uc2hpZnQoKSwgY2hhaW4uc2hpZnQoKSk7XG4gIH1cblxuICByZXR1cm4gcHJvbWlzZTtcbn07XG5cbi8vIEV4cG9zZSBkZWZhdWx0c1xuYXhpb3MuZGVmYXVsdHMgPSBkZWZhdWx0cztcblxuLy8gRXhwb3NlIGFsbC9zcHJlYWRcbmF4aW9zLmFsbCA9IGZ1bmN0aW9uIChwcm9taXNlcykge1xuICByZXR1cm4gUHJvbWlzZS5hbGwocHJvbWlzZXMpO1xufTtcbmF4aW9zLnNwcmVhZCA9IHJlcXVpcmUoJy4vaGVscGVycy9zcHJlYWQnKTtcblxuLy8gRXhwb3NlIGludGVyY2VwdG9yc1xuYXhpb3MuaW50ZXJjZXB0b3JzID0ge1xuICByZXF1ZXN0OiBuZXcgSW50ZXJjZXB0b3JNYW5hZ2VyKCksXG4gIHJlc3BvbnNlOiBuZXcgSW50ZXJjZXB0b3JNYW5hZ2VyKClcbn07XG5cbi8vIFByb3ZpZGUgYWxpYXNlcyBmb3Igc3VwcG9ydGVkIHJlcXVlc3QgbWV0aG9kc1xuKGZ1bmN0aW9uICgpIHtcbiAgZnVuY3Rpb24gY3JlYXRlU2hvcnRNZXRob2RzKCkge1xuICAgIHV0aWxzLmZvckVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAobWV0aG9kKSB7XG4gICAgICBheGlvc1ttZXRob2RdID0gZnVuY3Rpb24gKHVybCwgY29uZmlnKSB7XG4gICAgICAgIHJldHVybiBheGlvcyh1dGlscy5tZXJnZShjb25maWcgfHwge30sIHtcbiAgICAgICAgICBtZXRob2Q6IG1ldGhvZCxcbiAgICAgICAgICB1cmw6IHVybFxuICAgICAgICB9KSk7XG4gICAgICB9O1xuICAgIH0pO1xuICB9XG5cbiAgZnVuY3Rpb24gY3JlYXRlU2hvcnRNZXRob2RzV2l0aERhdGEoKSB7XG4gICAgdXRpbHMuZm9yRWFjaChhcmd1bWVudHMsIGZ1bmN0aW9uIChtZXRob2QpIHtcbiAgICAgIGF4aW9zW21ldGhvZF0gPSBmdW5jdGlvbiAodXJsLCBkYXRhLCBjb25maWcpIHtcbiAgICAgICAgcmV0dXJuIGF4aW9zKHV0aWxzLm1lcmdlKGNvbmZpZyB8fCB7fSwge1xuICAgICAgICAgIG1ldGhvZDogbWV0aG9kLFxuICAgICAgICAgIHVybDogdXJsLFxuICAgICAgICAgIGRhdGE6IGRhdGFcbiAgICAgICAgfSkpO1xuICAgICAgfTtcbiAgICB9KTtcbiAgfVxuXG4gIGNyZWF0ZVNob3J0TWV0aG9kcygnZGVsZXRlJywgJ2dldCcsICdoZWFkJyk7XG4gIGNyZWF0ZVNob3J0TWV0aG9kc1dpdGhEYXRhKCdwb3N0JywgJ3B1dCcsICdwYXRjaCcpO1xufSkoKTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi8uLi91dGlscycpO1xuXG5mdW5jdGlvbiBJbnRlcmNlcHRvck1hbmFnZXIoKSB7XG4gIHRoaXMuaGFuZGxlcnMgPSBbXTtcbn1cblxuLyoqXG4gKiBBZGQgYSBuZXcgaW50ZXJjZXB0b3IgdG8gdGhlIHN0YWNrXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gZnVsZmlsbGVkIFRoZSBmdW5jdGlvbiB0byBoYW5kbGUgYHRoZW5gIGZvciBhIGBQcm9taXNlYFxuICogQHBhcmFtIHtGdW5jdGlvbn0gcmVqZWN0ZWQgVGhlIGZ1bmN0aW9uIHRvIGhhbmRsZSBgcmVqZWN0YCBmb3IgYSBgUHJvbWlzZWBcbiAqXG4gKiBAcmV0dXJuIHtOdW1iZXJ9IEFuIElEIHVzZWQgdG8gcmVtb3ZlIGludGVyY2VwdG9yIGxhdGVyXG4gKi9cbkludGVyY2VwdG9yTWFuYWdlci5wcm90b3R5cGUudXNlID0gZnVuY3Rpb24gKGZ1bGZpbGxlZCwgcmVqZWN0ZWQpIHtcbiAgdGhpcy5oYW5kbGVycy5wdXNoKHtcbiAgICBmdWxmaWxsZWQ6IGZ1bGZpbGxlZCxcbiAgICByZWplY3RlZDogcmVqZWN0ZWRcbiAgfSk7XG4gIHJldHVybiB0aGlzLmhhbmRsZXJzLmxlbmd0aCAtIDE7XG59O1xuXG4vKipcbiAqIFJlbW92ZSBhbiBpbnRlcmNlcHRvciBmcm9tIHRoZSBzdGFja1xuICpcbiAqIEBwYXJhbSB7TnVtYmVyfSBpZCBUaGUgSUQgdGhhdCB3YXMgcmV0dXJuZWQgYnkgYHVzZWBcbiAqL1xuSW50ZXJjZXB0b3JNYW5hZ2VyLnByb3RvdHlwZS5lamVjdCA9IGZ1bmN0aW9uIChpZCkge1xuICBpZiAodGhpcy5oYW5kbGVyc1tpZF0pIHtcbiAgICB0aGlzLmhhbmRsZXJzW2lkXSA9IG51bGw7XG4gIH1cbn07XG5cbi8qKlxuICogSXRlcmF0ZSBvdmVyIGFsbCB0aGUgcmVnaXN0ZXJlZCBpbnRlcmNlcHRvcnNcbiAqXG4gKiBUaGlzIG1ldGhvZCBpcyBwYXJ0aWN1bGFybHkgdXNlZnVsIGZvciBza2lwcGluZyBvdmVyIGFueVxuICogaW50ZXJjZXB0b3JzIHRoYXQgbWF5IGhhdmUgYmVjb21lIGBudWxsYCBjYWxsaW5nIGByZW1vdmVgLlxuICpcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIFRoZSBmdW5jdGlvbiB0byBjYWxsIGZvciBlYWNoIGludGVyY2VwdG9yXG4gKi9cbkludGVyY2VwdG9yTWFuYWdlci5wcm90b3R5cGUuZm9yRWFjaCA9IGZ1bmN0aW9uIChmbikge1xuICB1dGlscy5mb3JFYWNoKHRoaXMuaGFuZGxlcnMsIGZ1bmN0aW9uIChoKSB7XG4gICAgaWYgKGggIT09IG51bGwpIHtcbiAgICAgIGZuKGgpO1xuICAgIH1cbiAgfSk7XG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IEludGVyY2VwdG9yTWFuYWdlcjtcbiIsIid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiBEaXNwYXRjaCBhIHJlcXVlc3QgdG8gdGhlIHNlcnZlciB1c2luZyB3aGljaGV2ZXIgYWRhcHRlclxuICogaXMgc3VwcG9ydGVkIGJ5IHRoZSBjdXJyZW50IGVudmlyb25tZW50LlxuICpcbiAqIEBwYXJhbSB7b2JqZWN0fSBjb25maWcgVGhlIGNvbmZpZyB0aGF0IGlzIHRvIGJlIHVzZWQgZm9yIHRoZSByZXF1ZXN0XG4gKiBAcmV0dXJucyB7UHJvbWlzZX0gVGhlIFByb21pc2UgdG8gYmUgZnVsZmlsbGVkXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gZGlzcGF0Y2hSZXF1ZXN0KGNvbmZpZykge1xuICByZXR1cm4gbmV3IFByb21pc2UoZnVuY3Rpb24gKHJlc29sdmUsIHJlamVjdCkge1xuICAgIHRyeSB7XG4gICAgICAvLyBGb3IgYnJvd3NlcnMgdXNlIFhIUiBhZGFwdGVyXG4gICAgICBpZiAoKHR5cGVvZiBYTUxIdHRwUmVxdWVzdCAhPT0gJ3VuZGVmaW5lZCcpIHx8ICh0eXBlb2YgQWN0aXZlWE9iamVjdCAhPT0gJ3VuZGVmaW5lZCcpKSB7XG4gICAgICAgIHJlcXVpcmUoJy4uL2FkYXB0ZXJzL3hocicpKHJlc29sdmUsIHJlamVjdCwgY29uZmlnKTtcbiAgICAgIH1cbiAgICAgIC8vIEZvciBub2RlIHVzZSBIVFRQIGFkYXB0ZXJcbiAgICAgIGVsc2UgaWYgKHR5cGVvZiBwcm9jZXNzICE9PSAndW5kZWZpbmVkJykge1xuICAgICAgICByZXF1aXJlKCcuLi9hZGFwdGVycy9odHRwJykocmVzb2x2ZSwgcmVqZWN0LCBjb25maWcpO1xuICAgICAgfVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHJlamVjdChlKTtcbiAgICB9XG4gIH0pO1xufTtcblxuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuL3V0aWxzJyk7XG5cbnZhciBQUk9URUNUSU9OX1BSRUZJWCA9IC9eXFwpXFxdXFx9Jyw/XFxuLztcbnZhciBERUZBVUxUX0NPTlRFTlRfVFlQRSA9IHtcbiAgJ0NvbnRlbnQtVHlwZSc6ICdhcHBsaWNhdGlvbi94LXd3dy1mb3JtLXVybGVuY29kZWQnXG59O1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgdHJhbnNmb3JtUmVxdWVzdDogW2Z1bmN0aW9uIChkYXRhLCBoZWFkZXJzKSB7XG4gICAgaWYodXRpbHMuaXNGb3JtRGF0YShkYXRhKSkge1xuICAgICAgcmV0dXJuIGRhdGE7XG4gICAgfVxuICAgIGlmICh1dGlscy5pc0FycmF5QnVmZmVyKGRhdGEpKSB7XG4gICAgICByZXR1cm4gZGF0YTtcbiAgICB9XG4gICAgaWYgKHV0aWxzLmlzQXJyYXlCdWZmZXJWaWV3KGRhdGEpKSB7XG4gICAgICByZXR1cm4gZGF0YS5idWZmZXI7XG4gICAgfVxuICAgIGlmICh1dGlscy5pc09iamVjdChkYXRhKSAmJiAhdXRpbHMuaXNGaWxlKGRhdGEpICYmICF1dGlscy5pc0Jsb2IoZGF0YSkpIHtcbiAgICAgIC8vIFNldCBhcHBsaWNhdGlvbi9qc29uIGlmIG5vIENvbnRlbnQtVHlwZSBoYXMgYmVlbiBzcGVjaWZpZWRcbiAgICAgIGlmICghdXRpbHMuaXNVbmRlZmluZWQoaGVhZGVycykpIHtcbiAgICAgICAgdXRpbHMuZm9yRWFjaChoZWFkZXJzLCBmdW5jdGlvbiAodmFsLCBrZXkpIHtcbiAgICAgICAgICBpZiAoa2V5LnRvTG93ZXJDYXNlKCkgPT09ICdjb250ZW50LXR5cGUnKSB7XG4gICAgICAgICAgICBoZWFkZXJzWydDb250ZW50LVR5cGUnXSA9IHZhbDtcbiAgICAgICAgICB9XG4gICAgICAgIH0pO1xuXG4gICAgICAgIGlmICh1dGlscy5pc1VuZGVmaW5lZChoZWFkZXJzWydDb250ZW50LVR5cGUnXSkpIHtcbiAgICAgICAgICBoZWFkZXJzWydDb250ZW50LVR5cGUnXSA9ICdhcHBsaWNhdGlvbi9qc29uO2NoYXJzZXQ9dXRmLTgnO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgICByZXR1cm4gSlNPTi5zdHJpbmdpZnkoZGF0YSk7XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9XSxcblxuICB0cmFuc2Zvcm1SZXNwb25zZTogW2Z1bmN0aW9uIChkYXRhKSB7XG4gICAgaWYgKHR5cGVvZiBkYXRhID09PSAnc3RyaW5nJykge1xuICAgICAgZGF0YSA9IGRhdGEucmVwbGFjZShQUk9URUNUSU9OX1BSRUZJWCwgJycpO1xuICAgICAgdHJ5IHtcbiAgICAgICAgZGF0YSA9IEpTT04ucGFyc2UoZGF0YSk7XG4gICAgICB9IGNhdGNoIChlKSB7IC8qIElnbm9yZSAqLyB9XG4gICAgfVxuICAgIHJldHVybiBkYXRhO1xuICB9XSxcblxuICBoZWFkZXJzOiB7XG4gICAgY29tbW9uOiB7XG4gICAgICAnQWNjZXB0JzogJ2FwcGxpY2F0aW9uL2pzb24sIHRleHQvcGxhaW4sICovKidcbiAgICB9LFxuICAgIHBhdGNoOiB1dGlscy5tZXJnZShERUZBVUxUX0NPTlRFTlRfVFlQRSksXG4gICAgcG9zdDogdXRpbHMubWVyZ2UoREVGQVVMVF9DT05URU5UX1RZUEUpLFxuICAgIHB1dDogdXRpbHMubWVyZ2UoREVGQVVMVF9DT05URU5UX1RZUEUpXG4gIH0sXG5cbiAgdGltZW91dDogMCxcblxuICB4c3JmQ29va2llTmFtZTogJ1hTUkYtVE9LRU4nLFxuICB4c3JmSGVhZGVyTmFtZTogJ1gtWFNSRi1UT0tFTidcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciB1dGlscyA9IHJlcXVpcmUoJy4vLi4vdXRpbHMnKTtcblxuZnVuY3Rpb24gZW5jb2RlKHZhbCkge1xuICByZXR1cm4gZW5jb2RlVVJJQ29tcG9uZW50KHZhbCkuXG4gICAgcmVwbGFjZSgvJTQwL2dpLCAnQCcpLlxuICAgIHJlcGxhY2UoLyUzQS9naSwgJzonKS5cbiAgICByZXBsYWNlKC8lMjQvZywgJyQnKS5cbiAgICByZXBsYWNlKC8lMkMvZ2ksICcsJykuXG4gICAgcmVwbGFjZSgvJTIwL2csICcrJykuXG4gICAgcmVwbGFjZSgvJTVCL2dpLCAnWycpLlxuICAgIHJlcGxhY2UoLyU1RC9naSwgJ10nKTtcbn1cblxuLyoqXG4gKiBCdWlsZCBhIFVSTCBieSBhcHBlbmRpbmcgcGFyYW1zIHRvIHRoZSBlbmRcbiAqXG4gKiBAcGFyYW0ge3N0cmluZ30gdXJsIFRoZSBiYXNlIG9mIHRoZSB1cmwgKGUuZy4sIGh0dHA6Ly93d3cuZ29vZ2xlLmNvbSlcbiAqIEBwYXJhbSB7b2JqZWN0fSBbcGFyYW1zXSBUaGUgcGFyYW1zIHRvIGJlIGFwcGVuZGVkXG4gKiBAcmV0dXJucyB7c3RyaW5nfSBUaGUgZm9ybWF0dGVkIHVybFxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGJ1aWxkVXJsKHVybCwgcGFyYW1zKSB7XG4gIGlmICghcGFyYW1zKSB7XG4gICAgcmV0dXJuIHVybDtcbiAgfVxuXG4gIHZhciBwYXJ0cyA9IFtdO1xuXG4gIHV0aWxzLmZvckVhY2gocGFyYW1zLCBmdW5jdGlvbiAodmFsLCBrZXkpIHtcbiAgICBpZiAodmFsID09PSBudWxsIHx8IHR5cGVvZiB2YWwgPT09ICd1bmRlZmluZWQnKSB7XG4gICAgICByZXR1cm47XG4gICAgfVxuXG4gICAgaWYgKHV0aWxzLmlzQXJyYXkodmFsKSkge1xuICAgICAga2V5ID0ga2V5ICsgJ1tdJztcbiAgICB9XG5cbiAgICBpZiAoIXV0aWxzLmlzQXJyYXkodmFsKSkge1xuICAgICAgdmFsID0gW3ZhbF07XG4gICAgfVxuXG4gICAgdXRpbHMuZm9yRWFjaCh2YWwsIGZ1bmN0aW9uICh2KSB7XG4gICAgICBpZiAodXRpbHMuaXNEYXRlKHYpKSB7XG4gICAgICAgIHYgPSB2LnRvSVNPU3RyaW5nKCk7XG4gICAgICB9XG4gICAgICBlbHNlIGlmICh1dGlscy5pc09iamVjdCh2KSkge1xuICAgICAgICB2ID0gSlNPTi5zdHJpbmdpZnkodik7XG4gICAgICB9XG4gICAgICBwYXJ0cy5wdXNoKGVuY29kZShrZXkpICsgJz0nICsgZW5jb2RlKHYpKTtcbiAgICB9KTtcbiAgfSk7XG5cbiAgaWYgKHBhcnRzLmxlbmd0aCA+IDApIHtcbiAgICB1cmwgKz0gKHVybC5pbmRleE9mKCc/JykgPT09IC0xID8gJz8nIDogJyYnKSArIHBhcnRzLmpvaW4oJyYnKTtcbiAgfVxuXG4gIHJldHVybiB1cmw7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIFdBUk5JTkc6XG4gKiAgVGhpcyBmaWxlIG1ha2VzIHJlZmVyZW5jZXMgdG8gb2JqZWN0cyB0aGF0IGFyZW4ndCBzYWZlIGluIGFsbCBlbnZpcm9ubWVudHMuXG4gKiAgUGxlYXNlIHNlZSBsaWIvdXRpbHMuaXNTdGFuZGFyZEJyb3dzZXJFbnYgYmVmb3JlIGluY2x1ZGluZyB0aGlzIGZpbGUuXG4gKi9cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi8uLi91dGlscycpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgd3JpdGU6IGZ1bmN0aW9uIHdyaXRlKG5hbWUsIHZhbHVlLCBleHBpcmVzLCBwYXRoLCBkb21haW4sIHNlY3VyZSkge1xuICAgIHZhciBjb29raWUgPSBbXTtcbiAgICBjb29raWUucHVzaChuYW1lICsgJz0nICsgZW5jb2RlVVJJQ29tcG9uZW50KHZhbHVlKSk7XG5cbiAgICBpZiAodXRpbHMuaXNOdW1iZXIoZXhwaXJlcykpIHtcbiAgICAgIGNvb2tpZS5wdXNoKCdleHBpcmVzPScgKyBuZXcgRGF0ZShleHBpcmVzKS50b0dNVFN0cmluZygpKTtcbiAgICB9XG5cbiAgICBpZiAodXRpbHMuaXNTdHJpbmcocGF0aCkpIHtcbiAgICAgIGNvb2tpZS5wdXNoKCdwYXRoPScgKyBwYXRoKTtcbiAgICB9XG5cbiAgICBpZiAodXRpbHMuaXNTdHJpbmcoZG9tYWluKSkge1xuICAgICAgY29va2llLnB1c2goJ2RvbWFpbj0nICsgZG9tYWluKTtcbiAgICB9XG5cbiAgICBpZiAoc2VjdXJlID09PSB0cnVlKSB7XG4gICAgICBjb29raWUucHVzaCgnc2VjdXJlJyk7XG4gICAgfVxuXG4gICAgZG9jdW1lbnQuY29va2llID0gY29va2llLmpvaW4oJzsgJyk7XG4gIH0sXG5cbiAgcmVhZDogZnVuY3Rpb24gcmVhZChuYW1lKSB7XG4gICAgdmFyIG1hdGNoID0gZG9jdW1lbnQuY29va2llLm1hdGNoKG5ldyBSZWdFeHAoJyhefDtcXFxccyopKCcgKyBuYW1lICsgJyk9KFteO10qKScpKTtcbiAgICByZXR1cm4gKG1hdGNoID8gZGVjb2RlVVJJQ29tcG9uZW50KG1hdGNoWzNdKSA6IG51bGwpO1xuICB9LFxuXG4gIHJlbW92ZTogZnVuY3Rpb24gcmVtb3ZlKG5hbWUpIHtcbiAgICB0aGlzLndyaXRlKG5hbWUsICcnLCBEYXRlLm5vdygpIC0gODY0MDAwMDApO1xuICB9XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgdXRpbHMgPSByZXF1aXJlKCcuLy4uL3V0aWxzJyk7XG5cbi8qKlxuICogUGFyc2UgaGVhZGVycyBpbnRvIGFuIG9iamVjdFxuICpcbiAqIGBgYFxuICogRGF0ZTogV2VkLCAyNyBBdWcgMjAxNCAwODo1ODo0OSBHTVRcbiAqIENvbnRlbnQtVHlwZTogYXBwbGljYXRpb24vanNvblxuICogQ29ubmVjdGlvbjoga2VlcC1hbGl2ZVxuICogVHJhbnNmZXItRW5jb2Rpbmc6IGNodW5rZWRcbiAqIGBgYFxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBoZWFkZXJzIEhlYWRlcnMgbmVlZGluZyB0byBiZSBwYXJzZWRcbiAqIEByZXR1cm5zIHtPYmplY3R9IEhlYWRlcnMgcGFyc2VkIGludG8gYW4gb2JqZWN0XG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gcGFyc2VIZWFkZXJzKGhlYWRlcnMpIHtcbiAgdmFyIHBhcnNlZCA9IHt9LCBrZXksIHZhbCwgaTtcblxuICBpZiAoIWhlYWRlcnMpIHsgcmV0dXJuIHBhcnNlZDsgfVxuXG4gIHV0aWxzLmZvckVhY2goaGVhZGVycy5zcGxpdCgnXFxuJyksIGZ1bmN0aW9uKGxpbmUpIHtcbiAgICBpID0gbGluZS5pbmRleE9mKCc6Jyk7XG4gICAga2V5ID0gdXRpbHMudHJpbShsaW5lLnN1YnN0cigwLCBpKSkudG9Mb3dlckNhc2UoKTtcbiAgICB2YWwgPSB1dGlscy50cmltKGxpbmUuc3Vic3RyKGkgKyAxKSk7XG5cbiAgICBpZiAoa2V5KSB7XG4gICAgICBwYXJzZWRba2V5XSA9IHBhcnNlZFtrZXldID8gcGFyc2VkW2tleV0gKyAnLCAnICsgdmFsIDogdmFsO1xuICAgIH1cbiAgfSk7XG5cbiAgcmV0dXJuIHBhcnNlZDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbi8qKlxuICogU3ludGFjdGljIHN1Z2FyIGZvciBpbnZva2luZyBhIGZ1bmN0aW9uIGFuZCBleHBhbmRpbmcgYW4gYXJyYXkgZm9yIGFyZ3VtZW50cy5cbiAqXG4gKiBDb21tb24gdXNlIGNhc2Ugd291bGQgYmUgdG8gdXNlIGBGdW5jdGlvbi5wcm90b3R5cGUuYXBwbHlgLlxuICpcbiAqICBgYGBqc1xuICogIGZ1bmN0aW9uIGYoeCwgeSwgeikge31cbiAqICB2YXIgYXJncyA9IFsxLCAyLCAzXTtcbiAqICBmLmFwcGx5KG51bGwsIGFyZ3MpO1xuICogIGBgYFxuICpcbiAqIFdpdGggYHNwcmVhZGAgdGhpcyBleGFtcGxlIGNhbiBiZSByZS13cml0dGVuLlxuICpcbiAqICBgYGBqc1xuICogIHNwcmVhZChmdW5jdGlvbih4LCB5LCB6KSB7fSkoWzEsIDIsIDNdKTtcbiAqICBgYGBcbiAqXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBjYWxsYmFja1xuICogQHJldHVybnMge0Z1bmN0aW9ufVxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIHNwcmVhZChjYWxsYmFjaykge1xuICByZXR1cm4gZnVuY3Rpb24gKGFycikge1xuICAgIHJldHVybiBjYWxsYmFjay5hcHBseShudWxsLCBhcnIpO1xuICB9O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi8uLi91dGlscycpO1xuXG4vKipcbiAqIFRyYW5zZm9ybSB0aGUgZGF0YSBmb3IgYSByZXF1ZXN0IG9yIGEgcmVzcG9uc2VcbiAqXG4gKiBAcGFyYW0ge09iamVjdHxTdHJpbmd9IGRhdGEgVGhlIGRhdGEgdG8gYmUgdHJhbnNmb3JtZWRcbiAqIEBwYXJhbSB7QXJyYXl9IGhlYWRlcnMgVGhlIGhlYWRlcnMgZm9yIHRoZSByZXF1ZXN0IG9yIHJlc3BvbnNlXG4gKiBAcGFyYW0ge0FycmF5fEZ1bmN0aW9ufSBmbnMgQSBzaW5nbGUgZnVuY3Rpb24gb3IgQXJyYXkgb2YgZnVuY3Rpb25zXG4gKiBAcmV0dXJucyB7Kn0gVGhlIHJlc3VsdGluZyB0cmFuc2Zvcm1lZCBkYXRhXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gdHJhbnNmb3JtRGF0YShkYXRhLCBoZWFkZXJzLCBmbnMpIHtcbiAgdXRpbHMuZm9yRWFjaChmbnMsIGZ1bmN0aW9uIChmbikge1xuICAgIGRhdGEgPSBmbihkYXRhLCBoZWFkZXJzKTtcbiAgfSk7XG5cbiAgcmV0dXJuIGRhdGE7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIFdBUk5JTkc6XG4gKiAgVGhpcyBmaWxlIG1ha2VzIHJlZmVyZW5jZXMgdG8gb2JqZWN0cyB0aGF0IGFyZW4ndCBzYWZlIGluIGFsbCBlbnZpcm9ubWVudHMuXG4gKiAgUGxlYXNlIHNlZSBsaWIvdXRpbHMuaXNTdGFuZGFyZEJyb3dzZXJFbnYgYmVmb3JlIGluY2x1ZGluZyB0aGlzIGZpbGUuXG4gKi9cblxudmFyIHV0aWxzID0gcmVxdWlyZSgnLi8uLi91dGlscycpO1xudmFyIG1zaWUgPSAvKG1zaWV8dHJpZGVudCkvaS50ZXN0KG5hdmlnYXRvci51c2VyQWdlbnQpO1xudmFyIHVybFBhcnNpbmdOb2RlID0gZG9jdW1lbnQuY3JlYXRlRWxlbWVudCgnYScpO1xudmFyIG9yaWdpblVybDtcblxuLyoqXG4gKiBQYXJzZSBhIFVSTCB0byBkaXNjb3ZlciBpdCdzIGNvbXBvbmVudHNcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gdXJsIFRoZSBVUkwgdG8gYmUgcGFyc2VkXG4gKiBAcmV0dXJucyB7T2JqZWN0fVxuICovXG5mdW5jdGlvbiB1cmxSZXNvbHZlKHVybCkge1xuICB2YXIgaHJlZiA9IHVybDtcblxuICBpZiAobXNpZSkge1xuICAgIC8vIElFIG5lZWRzIGF0dHJpYnV0ZSBzZXQgdHdpY2UgdG8gbm9ybWFsaXplIHByb3BlcnRpZXNcbiAgICB1cmxQYXJzaW5nTm9kZS5zZXRBdHRyaWJ1dGUoJ2hyZWYnLCBocmVmKTtcbiAgICBocmVmID0gdXJsUGFyc2luZ05vZGUuaHJlZjtcbiAgfVxuXG4gIHVybFBhcnNpbmdOb2RlLnNldEF0dHJpYnV0ZSgnaHJlZicsIGhyZWYpO1xuXG4gIC8vIHVybFBhcnNpbmdOb2RlIHByb3ZpZGVzIHRoZSBVcmxVdGlscyBpbnRlcmZhY2UgLSBodHRwOi8vdXJsLnNwZWMud2hhdHdnLm9yZy8jdXJsdXRpbHNcbiAgcmV0dXJuIHtcbiAgICBocmVmOiB1cmxQYXJzaW5nTm9kZS5ocmVmLFxuICAgIHByb3RvY29sOiB1cmxQYXJzaW5nTm9kZS5wcm90b2NvbCA/IHVybFBhcnNpbmdOb2RlLnByb3RvY29sLnJlcGxhY2UoLzokLywgJycpIDogJycsXG4gICAgaG9zdDogdXJsUGFyc2luZ05vZGUuaG9zdCxcbiAgICBzZWFyY2g6IHVybFBhcnNpbmdOb2RlLnNlYXJjaCA/IHVybFBhcnNpbmdOb2RlLnNlYXJjaC5yZXBsYWNlKC9eXFw/LywgJycpIDogJycsXG4gICAgaGFzaDogdXJsUGFyc2luZ05vZGUuaGFzaCA/IHVybFBhcnNpbmdOb2RlLmhhc2gucmVwbGFjZSgvXiMvLCAnJykgOiAnJyxcbiAgICBob3N0bmFtZTogdXJsUGFyc2luZ05vZGUuaG9zdG5hbWUsXG4gICAgcG9ydDogdXJsUGFyc2luZ05vZGUucG9ydCxcbiAgICBwYXRobmFtZTogKHVybFBhcnNpbmdOb2RlLnBhdGhuYW1lLmNoYXJBdCgwKSA9PT0gJy8nKSA/XG4gICAgICAgICAgICAgIHVybFBhcnNpbmdOb2RlLnBhdGhuYW1lIDpcbiAgICAgICAgICAgICAgJy8nICsgdXJsUGFyc2luZ05vZGUucGF0aG5hbWVcbiAgfTtcbn1cblxub3JpZ2luVXJsID0gdXJsUmVzb2x2ZSh3aW5kb3cubG9jYXRpb24uaHJlZik7XG5cbi8qKlxuICogRGV0ZXJtaW5lIGlmIGEgVVJMIHNoYXJlcyB0aGUgc2FtZSBvcmlnaW4gYXMgdGhlIGN1cnJlbnQgbG9jYXRpb25cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gcmVxdWVzdFVybCBUaGUgVVJMIHRvIHRlc3RcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIFVSTCBzaGFyZXMgdGhlIHNhbWUgb3JpZ2luLCBvdGhlcndpc2UgZmFsc2VcbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiB1cmxJc1NhbWVPcmlnaW4ocmVxdWVzdFVybCkge1xuICB2YXIgcGFyc2VkID0gKHV0aWxzLmlzU3RyaW5nKHJlcXVlc3RVcmwpKSA/IHVybFJlc29sdmUocmVxdWVzdFVybCkgOiByZXF1ZXN0VXJsO1xuICByZXR1cm4gKHBhcnNlZC5wcm90b2NvbCA9PT0gb3JpZ2luVXJsLnByb3RvY29sICYmXG4gICAgICAgIHBhcnNlZC5ob3N0ID09PSBvcmlnaW5VcmwuaG9zdCk7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG4vKmdsb2JhbCB0b1N0cmluZzp0cnVlKi9cblxuLy8gdXRpbHMgaXMgYSBsaWJyYXJ5IG9mIGdlbmVyaWMgaGVscGVyIGZ1bmN0aW9ucyBub24tc3BlY2lmaWMgdG8gYXhpb3NcblxudmFyIHRvU3RyaW5nID0gT2JqZWN0LnByb3RvdHlwZS50b1N0cmluZztcblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhbiBBcnJheVxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSB2YWwgVGhlIHZhbHVlIHRvIHRlc3RcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHZhbHVlIGlzIGFuIEFycmF5LCBvdGhlcndpc2UgZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNBcnJheSh2YWwpIHtcbiAgcmV0dXJuIHRvU3RyaW5nLmNhbGwodmFsKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhbiBBcnJheUJ1ZmZlclxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSB2YWwgVGhlIHZhbHVlIHRvIHRlc3RcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHZhbHVlIGlzIGFuIEFycmF5QnVmZmVyLCBvdGhlcndpc2UgZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNBcnJheUJ1ZmZlcih2YWwpIHtcbiAgcmV0dXJuIHRvU3RyaW5nLmNhbGwodmFsKSA9PT0gJ1tvYmplY3QgQXJyYXlCdWZmZXJdJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhIEZvcm1EYXRhXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IHZhbCBUaGUgdmFsdWUgdG8gdGVzdFxuICogQHJldHVybnMge2Jvb2xlYW59IFRydWUgaWYgdmFsdWUgaXMgYW4gRm9ybURhdGEsIG90aGVyd2lzZSBmYWxzZVxuICovXG5mdW5jdGlvbiBpc0Zvcm1EYXRhKHZhbCkge1xuICByZXR1cm4gdG9TdHJpbmcuY2FsbCh2YWwpID09PSAnW29iamVjdCBGb3JtRGF0YV0nO1xufVxuXG4vKipcbiAqIERldGVybWluZSBpZiBhIHZhbHVlIGlzIGEgdmlldyBvbiBhbiBBcnJheUJ1ZmZlclxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSB2YWwgVGhlIHZhbHVlIHRvIHRlc3RcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHZhbHVlIGlzIGEgdmlldyBvbiBhbiBBcnJheUJ1ZmZlciwgb3RoZXJ3aXNlIGZhbHNlXG4gKi9cbmZ1bmN0aW9uIGlzQXJyYXlCdWZmZXJWaWV3KHZhbCkge1xuICBpZiAoKHR5cGVvZiBBcnJheUJ1ZmZlciAhPT0gJ3VuZGVmaW5lZCcpICYmIChBcnJheUJ1ZmZlci5pc1ZpZXcpKSB7XG4gICAgcmV0dXJuIEFycmF5QnVmZmVyLmlzVmlldyh2YWwpO1xuICB9IGVsc2Uge1xuICAgIHJldHVybiAodmFsKSAmJiAodmFsLmJ1ZmZlcikgJiYgKHZhbC5idWZmZXIgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcik7XG4gIH1cbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhIFN0cmluZ1xuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSB2YWwgVGhlIHZhbHVlIHRvIHRlc3RcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHZhbHVlIGlzIGEgU3RyaW5nLCBvdGhlcndpc2UgZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNTdHJpbmcodmFsKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsID09PSAnc3RyaW5nJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhIE51bWJlclxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSB2YWwgVGhlIHZhbHVlIHRvIHRlc3RcbiAqIEByZXR1cm5zIHtib29sZWFufSBUcnVlIGlmIHZhbHVlIGlzIGEgTnVtYmVyLCBvdGhlcndpc2UgZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNOdW1iZXIodmFsKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsID09PSAnbnVtYmVyJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyB1bmRlZmluZWRcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsIFRoZSB2YWx1ZSB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB0aGUgdmFsdWUgaXMgdW5kZWZpbmVkLCBvdGhlcndpc2UgZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNVbmRlZmluZWQodmFsKSB7XG4gIHJldHVybiB0eXBlb2YgdmFsID09PSAndW5kZWZpbmVkJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhbiBPYmplY3RcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsIFRoZSB2YWx1ZSB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB2YWx1ZSBpcyBhbiBPYmplY3QsIG90aGVyd2lzZSBmYWxzZVxuICovXG5mdW5jdGlvbiBpc09iamVjdCh2YWwpIHtcbiAgcmV0dXJuIHZhbCAhPT0gbnVsbCAmJiB0eXBlb2YgdmFsID09PSAnb2JqZWN0Jztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhIERhdGVcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsIFRoZSB2YWx1ZSB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB2YWx1ZSBpcyBhIERhdGUsIG90aGVyd2lzZSBmYWxzZVxuICovXG5mdW5jdGlvbiBpc0RhdGUodmFsKSB7XG4gIHJldHVybiB0b1N0cmluZy5jYWxsKHZhbCkgPT09ICdbb2JqZWN0IERhdGVdJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhIEZpbGVcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsIFRoZSB2YWx1ZSB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB2YWx1ZSBpcyBhIEZpbGUsIG90aGVyd2lzZSBmYWxzZVxuICovXG5mdW5jdGlvbiBpc0ZpbGUodmFsKSB7XG4gIHJldHVybiB0b1N0cmluZy5jYWxsKHZhbCkgPT09ICdbb2JqZWN0IEZpbGVdJztcbn1cblxuLyoqXG4gKiBEZXRlcm1pbmUgaWYgYSB2YWx1ZSBpcyBhIEJsb2JcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsIFRoZSB2YWx1ZSB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB2YWx1ZSBpcyBhIEJsb2IsIG90aGVyd2lzZSBmYWxzZVxuICovXG5mdW5jdGlvbiBpc0Jsb2IodmFsKSB7XG4gIHJldHVybiB0b1N0cmluZy5jYWxsKHZhbCkgPT09ICdbb2JqZWN0IEJsb2JdJztcbn1cblxuLyoqXG4gKiBUcmltIGV4Y2VzcyB3aGl0ZXNwYWNlIG9mZiB0aGUgYmVnaW5uaW5nIGFuZCBlbmQgb2YgYSBzdHJpbmdcbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gc3RyIFRoZSBTdHJpbmcgdG8gdHJpbVxuICogQHJldHVybnMge1N0cmluZ30gVGhlIFN0cmluZyBmcmVlZCBvZiBleGNlc3Mgd2hpdGVzcGFjZVxuICovXG5mdW5jdGlvbiB0cmltKHN0cikge1xuICByZXR1cm4gc3RyLnJlcGxhY2UoL15cXHMqLywgJycpLnJlcGxhY2UoL1xccyokLywgJycpO1xufVxuXG4vKipcbiAqIERldGVybWluZSBpZiBhIHZhbHVlIGlzIGFuIEFyZ3VtZW50cyBvYmplY3RcbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsIFRoZSB2YWx1ZSB0byB0ZXN0XG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gVHJ1ZSBpZiB2YWx1ZSBpcyBhbiBBcmd1bWVudHMgb2JqZWN0LCBvdGhlcndpc2UgZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNBcmd1bWVudHModmFsKSB7XG4gIHJldHVybiB0b1N0cmluZy5jYWxsKHZhbCkgPT09ICdbb2JqZWN0IEFyZ3VtZW50c10nO1xufVxuXG4vKipcbiAqIERldGVybWluZSBpZiB3ZSdyZSBydW5uaW5nIGluIGEgc3RhbmRhcmQgYnJvd3NlciBlbnZpcm9ubWVudFxuICpcbiAqIFRoaXMgYWxsb3dzIGF4aW9zIHRvIHJ1biBpbiBhIHdlYiB3b3JrZXIsIGFuZCByZWFjdC1uYXRpdmUuXG4gKiBCb3RoIGVudmlyb25tZW50cyBzdXBwb3J0IFhNTEh0dHBSZXF1ZXN0LCBidXQgbm90IGZ1bGx5IHN0YW5kYXJkIGdsb2JhbHMuXG4gKlxuICogd2ViIHdvcmtlcnM6XG4gKiAgdHlwZW9mIHdpbmRvdyAtPiB1bmRlZmluZWRcbiAqICB0eXBlb2YgZG9jdW1lbnQgLT4gdW5kZWZpbmVkXG4gKlxuICogcmVhY3QtbmF0aXZlOlxuICogIHR5cGVvZiBkb2N1bWVudC5jcmVhdGVlbGVtZW50IC0+IHVuZGVmaW5lZFxuICovXG5mdW5jdGlvbiBpc1N0YW5kYXJkQnJvd3NlckVudigpIHtcbiAgcmV0dXJuIChcbiAgICB0eXBlb2Ygd2luZG93ICE9PSAndW5kZWZpbmVkJyAmJlxuICAgIHR5cGVvZiBkb2N1bWVudCAhPT0gJ3VuZGVmaW5lZCcgJiZcbiAgICB0eXBlb2YgZG9jdW1lbnQuY3JlYXRlRWxlbWVudCA9PT0gJ2Z1bmN0aW9uJ1xuICApO1xufVxuXG4vKipcbiAqIEl0ZXJhdGUgb3ZlciBhbiBBcnJheSBvciBhbiBPYmplY3QgaW52b2tpbmcgYSBmdW5jdGlvbiBmb3IgZWFjaCBpdGVtLlxuICpcbiAqIElmIGBvYmpgIGlzIGFuIEFycmF5IG9yIGFyZ3VtZW50cyBjYWxsYmFjayB3aWxsIGJlIGNhbGxlZCBwYXNzaW5nXG4gKiB0aGUgdmFsdWUsIGluZGV4LCBhbmQgY29tcGxldGUgYXJyYXkgZm9yIGVhY2ggaXRlbS5cbiAqXG4gKiBJZiAnb2JqJyBpcyBhbiBPYmplY3QgY2FsbGJhY2sgd2lsbCBiZSBjYWxsZWQgcGFzc2luZ1xuICogdGhlIHZhbHVlLCBrZXksIGFuZCBjb21wbGV0ZSBvYmplY3QgZm9yIGVhY2ggcHJvcGVydHkuXG4gKlxuICogQHBhcmFtIHtPYmplY3R8QXJyYXl9IG9iaiBUaGUgb2JqZWN0IHRvIGl0ZXJhdGVcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuIFRoZSBjYWxsYmFjayB0byBpbnZva2UgZm9yIGVhY2ggaXRlbVxuICovXG5mdW5jdGlvbiBmb3JFYWNoKG9iaiwgZm4pIHtcbiAgLy8gRG9uJ3QgYm90aGVyIGlmIG5vIHZhbHVlIHByb3ZpZGVkXG4gIGlmIChvYmogPT09IG51bGwgfHwgdHlwZW9mIG9iaiA9PT0gJ3VuZGVmaW5lZCcpIHtcbiAgICByZXR1cm47XG4gIH1cblxuICAvLyBDaGVjayBpZiBvYmogaXMgYXJyYXktbGlrZVxuICB2YXIgaXNBcnJheUxpa2UgPSBpc0FycmF5KG9iaikgfHwgaXNBcmd1bWVudHMob2JqKTtcblxuICAvLyBGb3JjZSBhbiBhcnJheSBpZiBub3QgYWxyZWFkeSBzb21ldGhpbmcgaXRlcmFibGVcbiAgaWYgKHR5cGVvZiBvYmogIT09ICdvYmplY3QnICYmICFpc0FycmF5TGlrZSkge1xuICAgIG9iaiA9IFtvYmpdO1xuICB9XG5cbiAgLy8gSXRlcmF0ZSBvdmVyIGFycmF5IHZhbHVlc1xuICBpZiAoaXNBcnJheUxpa2UpIHtcbiAgICBmb3IgKHZhciBpID0gMCwgbCA9IG9iai5sZW5ndGg7IGkgPCBsOyBpKyspIHtcbiAgICAgIGZuLmNhbGwobnVsbCwgb2JqW2ldLCBpLCBvYmopO1xuICAgIH1cbiAgfVxuICAvLyBJdGVyYXRlIG92ZXIgb2JqZWN0IGtleXNcbiAgZWxzZSB7XG4gICAgZm9yICh2YXIga2V5IGluIG9iaikge1xuICAgICAgaWYgKG9iai5oYXNPd25Qcm9wZXJ0eShrZXkpKSB7XG4gICAgICAgIGZuLmNhbGwobnVsbCwgb2JqW2tleV0sIGtleSwgb2JqKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbn1cblxuLyoqXG4gKiBBY2NlcHRzIHZhcmFyZ3MgZXhwZWN0aW5nIGVhY2ggYXJndW1lbnQgdG8gYmUgYW4gb2JqZWN0LCB0aGVuXG4gKiBpbW11dGFibHkgbWVyZ2VzIHRoZSBwcm9wZXJ0aWVzIG9mIGVhY2ggb2JqZWN0IGFuZCByZXR1cm5zIHJlc3VsdC5cbiAqXG4gKiBXaGVuIG11bHRpcGxlIG9iamVjdHMgY29udGFpbiB0aGUgc2FtZSBrZXkgdGhlIGxhdGVyIG9iamVjdCBpblxuICogdGhlIGFyZ3VtZW50cyBsaXN0IHdpbGwgdGFrZSBwcmVjZWRlbmNlLlxuICpcbiAqIEV4YW1wbGU6XG4gKlxuICogYGBganNcbiAqIHZhciByZXN1bHQgPSBtZXJnZSh7Zm9vOiAxMjN9LCB7Zm9vOiA0NTZ9KTtcbiAqIGNvbnNvbGUubG9nKHJlc3VsdC5mb28pOyAvLyBvdXRwdXRzIDQ1NlxuICogYGBgXG4gKlxuICogQHBhcmFtIHtPYmplY3R9IG9iajEgT2JqZWN0IHRvIG1lcmdlXG4gKiBAcmV0dXJucyB7T2JqZWN0fSBSZXN1bHQgb2YgYWxsIG1lcmdlIHByb3BlcnRpZXNcbiAqL1xuZnVuY3Rpb24gbWVyZ2UoLypvYmoxLCBvYmoyLCBvYmozLCAuLi4qLykge1xuICB2YXIgcmVzdWx0ID0ge307XG4gIGZvckVhY2goYXJndW1lbnRzLCBmdW5jdGlvbiAob2JqKSB7XG4gICAgZm9yRWFjaChvYmosIGZ1bmN0aW9uICh2YWwsIGtleSkge1xuICAgICAgcmVzdWx0W2tleV0gPSB2YWw7XG4gICAgfSk7XG4gIH0pO1xuICByZXR1cm4gcmVzdWx0O1xufVxuXG5tb2R1bGUuZXhwb3J0cyA9IHtcbiAgaXNBcnJheTogaXNBcnJheSxcbiAgaXNBcnJheUJ1ZmZlcjogaXNBcnJheUJ1ZmZlcixcbiAgaXNGb3JtRGF0YTogaXNGb3JtRGF0YSxcbiAgaXNBcnJheUJ1ZmZlclZpZXc6IGlzQXJyYXlCdWZmZXJWaWV3LFxuICBpc1N0cmluZzogaXNTdHJpbmcsXG4gIGlzTnVtYmVyOiBpc051bWJlcixcbiAgaXNPYmplY3Q6IGlzT2JqZWN0LFxuICBpc1VuZGVmaW5lZDogaXNVbmRlZmluZWQsXG4gIGlzRGF0ZTogaXNEYXRlLFxuICBpc0ZpbGU6IGlzRmlsZSxcbiAgaXNCbG9iOiBpc0Jsb2IsXG4gIGlzU3RhbmRhcmRCcm93c2VyRW52OiBpc1N0YW5kYXJkQnJvd3NlckVudixcbiAgZm9yRWFjaDogZm9yRWFjaCxcbiAgbWVyZ2U6IG1lcmdlLFxuICB0cmltOiB0cmltXG59O1xuIiwiLyoqXG4gKiBNb2R1bGUgZGVwZW5kZW5jaWVzLlxuICovXG5cbnZhciBFbWl0dGVyID0gcmVxdWlyZSgnY29tcG9uZW50LWVtaXR0ZXInKVxuXG4vKipcbiAqIEV4cG9zZSBgc2NlbmVgLlxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gQXBwbGljYXRpb25cblxuLyoqXG4gKiBDcmVhdGUgYSBuZXcgYEFwcGxpY2F0aW9uYC5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gZWxlbWVudCBPcHRpb25hbCBpbml0aWFsIGVsZW1lbnRcbiAqL1xuXG5mdW5jdGlvbiBBcHBsaWNhdGlvbiAoZWxlbWVudCkge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgQXBwbGljYXRpb24pKSByZXR1cm4gbmV3IEFwcGxpY2F0aW9uKGVsZW1lbnQpXG4gIHRoaXMub3B0aW9ucyA9IHt9XG4gIHRoaXMuc291cmNlcyA9IHt9XG4gIHRoaXMuZWxlbWVudCA9IGVsZW1lbnRcbn1cblxuLyoqXG4gKiBNaXhpbiBgRW1pdHRlcmAuXG4gKi9cblxuRW1pdHRlcihBcHBsaWNhdGlvbi5wcm90b3R5cGUpXG5cbi8qKlxuICogQWRkIGEgcGx1Z2luXG4gKlxuICogQHBhcmFtIHtGdW5jdGlvbn0gcGx1Z2luXG4gKi9cblxuQXBwbGljYXRpb24ucHJvdG90eXBlLnVzZSA9IGZ1bmN0aW9uIChwbHVnaW4pIHtcbiAgcGx1Z2luKHRoaXMpXG4gIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogU2V0IGFuIG9wdGlvblxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lXG4gKi9cblxuQXBwbGljYXRpb24ucHJvdG90eXBlLm9wdGlvbiA9IGZ1bmN0aW9uIChuYW1lLCB2YWwpIHtcbiAgdGhpcy5vcHRpb25zW25hbWVdID0gdmFsXG4gIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogU2V0IHZhbHVlIHVzZWQgc29tZXdoZXJlIGluIHRoZSBJTyBuZXR3b3JrLlxuICovXG5cbkFwcGxpY2F0aW9uLnByb3RvdHlwZS5zZXQgPSBmdW5jdGlvbiAobmFtZSwgZGF0YSkge1xuICB0aGlzLnNvdXJjZXNbbmFtZV0gPSBkYXRhXG4gIHRoaXMuZW1pdCgnc291cmNlJywgbmFtZSwgZGF0YSlcbiAgcmV0dXJuIHRoaXNcbn1cblxuLyoqXG4gKiBNb3VudCBhIHZpcnR1YWwgZWxlbWVudC5cbiAqXG4gKiBAcGFyYW0ge1ZpcnR1YWxFbGVtZW50fSBlbGVtZW50XG4gKi9cblxuQXBwbGljYXRpb24ucHJvdG90eXBlLm1vdW50ID0gZnVuY3Rpb24gKGVsZW1lbnQpIHtcbiAgdGhpcy5lbGVtZW50ID0gZWxlbWVudFxuICB0aGlzLmVtaXQoJ21vdW50JywgZWxlbWVudClcbiAgcmV0dXJuIHRoaXNcbn1cblxuLyoqXG4gKiBSZW1vdmUgdGhlIHdvcmxkLiBVbm1vdW50IGV2ZXJ5dGhpbmcuXG4gKi9cblxuQXBwbGljYXRpb24ucHJvdG90eXBlLnVubW91bnQgPSBmdW5jdGlvbiAoKSB7XG4gIGlmICghdGhpcy5lbGVtZW50KSByZXR1cm5cbiAgdGhpcy5lbGVtZW50ID0gbnVsbFxuICB0aGlzLmVtaXQoJ3VubW91bnQnKVxuICByZXR1cm4gdGhpc1xufVxuIiwiLyoqXG4gKiBBbGwgb2YgdGhlIGV2ZW50cyBjYW4gYmluZCB0b1xuICovXG5cbm1vZHVsZS5leHBvcnRzID0ge1xuICBvbkJsdXI6ICdibHVyJyxcbiAgb25DaGFuZ2U6ICdjaGFuZ2UnLFxuICBvbkNsaWNrOiAnY2xpY2snLFxuICBvbkNvbnRleHRNZW51OiAnY29udGV4dG1lbnUnLFxuICBvbkNvcHk6ICdjb3B5JyxcbiAgb25DdXQ6ICdjdXQnLFxuICBvbkRvdWJsZUNsaWNrOiAnZGJsY2xpY2snLFxuICBvbkRyYWc6ICdkcmFnJyxcbiAgb25EcmFnRW5kOiAnZHJhZ2VuZCcsXG4gIG9uRHJhZ0VudGVyOiAnZHJhZ2VudGVyJyxcbiAgb25EcmFnRXhpdDogJ2RyYWdleGl0JyxcbiAgb25EcmFnTGVhdmU6ICdkcmFnbGVhdmUnLFxuICBvbkRyYWdPdmVyOiAnZHJhZ292ZXInLFxuICBvbkRyYWdTdGFydDogJ2RyYWdzdGFydCcsXG4gIG9uRHJvcDogJ2Ryb3AnLFxuICBvbkVycm9yOiAnZXJyb3InLFxuICBvbkZvY3VzOiAnZm9jdXMnLFxuICBvbklucHV0OiAnaW5wdXQnLFxuICBvbkludmFsaWQ6ICdpbnZhbGlkJyxcbiAgb25LZXlEb3duOiAna2V5ZG93bicsXG4gIG9uS2V5UHJlc3M6ICdrZXlwcmVzcycsXG4gIG9uS2V5VXA6ICdrZXl1cCcsXG4gIG9uTW91c2VEb3duOiAnbW91c2Vkb3duJyxcbiAgb25Nb3VzZUVudGVyOiAnbW91c2VlbnRlcicsXG4gIG9uTW91c2VMZWF2ZTogJ21vdXNlbGVhdmUnLFxuICBvbk1vdXNlTW92ZTogJ21vdXNlbW92ZScsXG4gIG9uTW91c2VPdXQ6ICdtb3VzZW91dCcsXG4gIG9uTW91c2VPdmVyOiAnbW91c2VvdmVyJyxcbiAgb25Nb3VzZVVwOiAnbW91c2V1cCcsXG4gIG9uUGFzdGU6ICdwYXN0ZScsXG4gIG9uUmVzZXQ6ICdyZXNldCcsXG4gIG9uU2Nyb2xsOiAnc2Nyb2xsJyxcbiAgb25TdWJtaXQ6ICdzdWJtaXQnLFxuICBvblRvdWNoQ2FuY2VsOiAndG91Y2hjYW5jZWwnLFxuICBvblRvdWNoRW5kOiAndG91Y2hlbmQnLFxuICBvblRvdWNoTW92ZTogJ3RvdWNobW92ZScsXG4gIG9uVG91Y2hTdGFydDogJ3RvdWNoc3RhcnQnLFxuICBvbldoZWVsOiAnd2hlZWwnXG59XG4iLCIvKipcbiAqIENyZWF0ZSB0aGUgYXBwbGljYXRpb24uXG4gKi9cblxuZXhwb3J0cy50cmVlID1cbmV4cG9ydHMuc2NlbmUgPVxuZXhwb3J0cy5kZWt1ID0gcmVxdWlyZSgnLi9hcHBsaWNhdGlvbicpXG5cbi8qKlxuICogUmVuZGVyIHNjZW5lcyB0byB0aGUgRE9NLlxuICovXG5cbmlmICh0eXBlb2YgZG9jdW1lbnQgIT09ICd1bmRlZmluZWQnKSB7XG4gIGV4cG9ydHMucmVuZGVyID0gcmVxdWlyZSgnLi9yZW5kZXInKVxufVxuXG4vKipcbiAqIFJlbmRlciBzY2VuZXMgdG8gYSBzdHJpbmdcbiAqL1xuXG5leHBvcnRzLnJlbmRlclN0cmluZyA9IHJlcXVpcmUoJy4vc3RyaW5naWZ5JykiLCJ2YXIgdHlwZSA9IHJlcXVpcmUoJ2NvbXBvbmVudC10eXBlJylcblxuLyoqXG4gKiBSZXR1cm5zIHRoZSB0eXBlIG9mIGEgdmlydHVhbCBub2RlXG4gKlxuICogQHBhcmFtICB7T2JqZWN0fSBub2RlXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBub2RlVHlwZSAobm9kZSkge1xuICB2YXIgdiA9IHR5cGUobm9kZSlcbiAgaWYgKHYgPT09ICdudWxsJyB8fCBub2RlID09PSBmYWxzZSkgcmV0dXJuICdlbXB0eSdcbiAgaWYgKHYgIT09ICdvYmplY3QnKSByZXR1cm4gJ3RleHQnXG4gIGlmICh0eXBlKG5vZGUudHlwZSkgPT09ICdzdHJpbmcnKSByZXR1cm4gJ2VsZW1lbnQnXG4gIHJldHVybiAnY29tcG9uZW50J1xufVxuIiwiLyoqXG4gKiBEZXBlbmRlbmNpZXMuXG4gKi9cblxudmFyIHJhZiA9IHJlcXVpcmUoJ2NvbXBvbmVudC1yYWYnKVxudmFyIGlzRG9tID0gcmVxdWlyZSgnaXMtZG9tJylcbnZhciB1aWQgPSByZXF1aXJlKCdnZXQtdWlkJylcbnZhciBrZXlwYXRoID0gcmVxdWlyZSgnb2JqZWN0LXBhdGgnKVxudmFyIGV2ZW50cyA9IHJlcXVpcmUoJy4vZXZlbnRzJylcbnZhciBzdmcgPSByZXF1aXJlKCcuL3N2ZycpXG52YXIgZGVmYXVsdHMgPSByZXF1aXJlKCdvYmplY3QtZGVmYXVsdHMnKVxudmFyIGZvckVhY2ggPSByZXF1aXJlKCdmYXN0LmpzL2ZvckVhY2gnKVxudmFyIGFzc2lnbiA9IHJlcXVpcmUoJ2Zhc3QuanMvb2JqZWN0L2Fzc2lnbicpXG52YXIgcmVkdWNlID0gcmVxdWlyZSgnZmFzdC5qcy9yZWR1Y2UnKVxudmFyIG5vZGVUeXBlID0gcmVxdWlyZSgnLi9ub2RlLXR5cGUnKVxuXG4vKipcbiAqIEV4cG9zZSBgZG9tYC5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IHJlbmRlclxuXG4vKipcbiAqIFJlbmRlciBhbiBhcHAgdG8gdGhlIERPTVxuICpcbiAqIEBwYXJhbSB7QXBwbGljYXRpb259IGFwcFxuICogQHBhcmFtIHtIVE1MRWxlbWVudH0gY29udGFpbmVyXG4gKiBAcGFyYW0ge09iamVjdH0gb3B0c1xuICpcbiAqIEByZXR1cm4ge09iamVjdH1cbiAqL1xuXG5mdW5jdGlvbiByZW5kZXIgKGFwcCwgY29udGFpbmVyLCBvcHRzKSB7XG4gIHZhciBmcmFtZUlkXG4gIHZhciBpc1JlbmRlcmluZ1xuICB2YXIgcm9vdElkID0gJ3Jvb3QnXG4gIHZhciBjdXJyZW50RWxlbWVudFxuICB2YXIgY3VycmVudE5hdGl2ZUVsZW1lbnRcbiAgdmFyIGNvbm5lY3Rpb25zID0ge31cbiAgdmFyIGNvbXBvbmVudHMgPSB7fVxuICB2YXIgZW50aXRpZXMgPSB7fVxuICB2YXIgaGFuZGxlcnMgPSB7fVxuICB2YXIgbW91bnRRdWV1ZSA9IFtdXG4gIHZhciBjaGlsZHJlbiA9IHt9XG4gIGNoaWxkcmVuW3Jvb3RJZF0gPSB7fVxuXG4gIGlmICghaXNEb20oY29udGFpbmVyKSkge1xuICAgIHRocm93IG5ldyBFcnJvcignQ29udGFpbmVyIGVsZW1lbnQgbXVzdCBiZSBhIERPTSBlbGVtZW50JylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW5kZXJpbmcgb3B0aW9ucy4gQmF0Y2hpbmcgaXMgb25seSBldmVyIHJlYWxseSBkaXNhYmxlZFxuICAgKiB3aGVuIHJ1bm5pbmcgdGVzdHMsIGFuZCBwb29saW5nIGNhbiBiZSBkaXNhYmxlZCBpZiB0aGUgdXNlclxuICAgKiBpcyBkb2luZyBzb21ldGhpbmcgc3R1cGlkIHdpdGggdGhlIERPTSBpbiB0aGVpciBjb21wb25lbnRzLlxuICAgKi9cblxuICB2YXIgb3B0aW9ucyA9IGRlZmF1bHRzKGFzc2lnbih7fSwgYXBwLm9wdGlvbnMgfHwge30sIG9wdHMgfHwge30pLCB7XG4gICAgYmF0Y2hpbmc6IHRydWVcbiAgfSlcblxuICAvKipcbiAgICogTGlzdGVuIHRvIERPTSBldmVudHNcbiAgICovXG4gIHZhciByb290RWxlbWVudCA9IGdldFJvb3RFbGVtZW50KGNvbnRhaW5lcilcbiAgYWRkTmF0aXZlRXZlbnRMaXN0ZW5lcnMoKVxuXG4gIC8qKlxuICAgKiBXYXRjaCBmb3IgY2hhbmdlcyB0byB0aGUgYXBwIHNvIHRoYXQgd2UgY2FuIHVwZGF0ZVxuICAgKiB0aGUgRE9NIGFzIG5lZWRlZC5cbiAgICovXG5cbiAgYXBwLm9uKCd1bm1vdW50Jywgb251bm1vdW50KVxuICBhcHAub24oJ21vdW50Jywgb25tb3VudClcbiAgYXBwLm9uKCdzb3VyY2UnLCBvbnVwZGF0ZSlcblxuICAvKipcbiAgICogSWYgdGhlIGFwcCBoYXMgYWxyZWFkeSBtb3VudGVkIGFuIGVsZW1lbnQsIHdlIGNhbiBqdXN0XG4gICAqIHJlbmRlciB0aGF0IHN0cmFpZ2h0IGF3YXkuXG4gICAqL1xuXG4gIGlmIChhcHAuZWxlbWVudCkgcmVuZGVyKClcblxuICAvKipcbiAgICogVGVhcmRvd24gdGhlIERPTSByZW5kZXJpbmcgc28gdGhhdCBpdCBzdG9wc1xuICAgKiByZW5kZXJpbmcgYW5kIGV2ZXJ5dGhpbmcgY2FuIGJlIGdhcmJhZ2UgY29sbGVjdGVkLlxuICAgKi9cblxuICBmdW5jdGlvbiB0ZWFyZG93biAoKSB7XG4gICAgcmVtb3ZlTmF0aXZlRXZlbnRMaXN0ZW5lcnMoKVxuICAgIHJlbW92ZU5hdGl2ZUVsZW1lbnQoKVxuICAgIGFwcC5vZmYoJ3VubW91bnQnLCBvbnVubW91bnQpXG4gICAgYXBwLm9mZignbW91bnQnLCBvbm1vdW50KVxuICAgIGFwcC5vZmYoJ3NvdXJjZScsIG9udXBkYXRlKVxuICB9XG5cbiAgLyoqXG4gICAqIFN3YXAgdGhlIGN1cnJlbnQgcmVuZGVyZWQgbm9kZSB3aXRoIGEgbmV3IG9uZSB0aGF0IGlzIHJlbmRlcmVkXG4gICAqIGZyb20gdGhlIG5ldyB2aXJ0dWFsIGVsZW1lbnQgbW91bnRlZCBvbiB0aGUgYXBwLlxuICAgKlxuICAgKiBAcGFyYW0ge1ZpcnR1YWxFbGVtZW50fSBlbGVtZW50XG4gICAqL1xuXG4gIGZ1bmN0aW9uIG9ubW91bnQgKCkge1xuICAgIGludmFsaWRhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIElmIHRoZSBhcHAgdW5tb3VudHMgYW4gZWxlbWVudCwgd2Ugc2hvdWxkIGNsZWFyIG91dCB0aGUgY3VycmVudFxuICAgKiByZW5kZXJlZCBlbGVtZW50LiBUaGlzIHdpbGwgcmVtb3ZlIGFsbCB0aGUgZW50aXRpZXMuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIG9udW5tb3VudCAoKSB7XG4gICAgcmVtb3ZlTmF0aXZlRWxlbWVudCgpXG4gICAgY3VycmVudEVsZW1lbnQgPSBudWxsXG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGFsbCBjb21wb25lbnRzIHRoYXQgYXJlIGJvdW5kIHRvIHRoZSBzb3VyY2VcbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IG5hbWVcbiAgICogQHBhcmFtIHsqfSBkYXRhXG4gICAqL1xuXG4gIGZ1bmN0aW9uIG9udXBkYXRlIChuYW1lLCBkYXRhKSB7XG4gICAgaWYgKCFjb25uZWN0aW9uc1tuYW1lXSkgcmV0dXJuO1xuICAgIGNvbm5lY3Rpb25zW25hbWVdLmZvckVhY2goZnVuY3Rpb24odXBkYXRlKSB7XG4gICAgICB1cGRhdGUoZGF0YSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFJlbmRlciBhbmQgbW91bnQgYSBjb21wb25lbnQgdG8gdGhlIG5hdGl2ZSBkb20uXG4gICAqXG4gICAqIEBwYXJhbSB7RW50aXR5fSBlbnRpdHlcbiAgICogQHJldHVybiB7SFRNTEVsZW1lbnR9XG4gICAqL1xuXG4gIGZ1bmN0aW9uIG1vdW50RW50aXR5IChlbnRpdHkpIHtcbiAgICByZWdpc3RlcihlbnRpdHkpXG4gICAgc2V0U291cmNlcyhlbnRpdHkpXG4gICAgY2hpbGRyZW5bZW50aXR5LmlkXSA9IHt9XG4gICAgZW50aXRpZXNbZW50aXR5LmlkXSA9IGVudGl0eVxuXG4gICAgLy8gY29tbWl0IGluaXRpYWwgc3RhdGUgYW5kIHByb3BzLlxuICAgIGNvbW1pdChlbnRpdHkpXG5cbiAgICAvLyBjYWxsYmFjayBiZWZvcmUgbW91bnRpbmcuXG4gICAgdHJpZ2dlcignYmVmb3JlTW91bnQnLCBlbnRpdHksIFtlbnRpdHkuY29udGV4dF0pXG4gICAgdHJpZ2dlcignYmVmb3JlUmVuZGVyJywgZW50aXR5LCBbZW50aXR5LmNvbnRleHRdKVxuXG4gICAgLy8gcmVuZGVyIHZpcnR1YWwgZWxlbWVudC5cbiAgICB2YXIgdmlydHVhbEVsZW1lbnQgPSByZW5kZXJFbnRpdHkoZW50aXR5KVxuICAgIC8vIGNyZWF0ZSBuYXRpdmUgZWxlbWVudC5cbiAgICB2YXIgbmF0aXZlRWxlbWVudCA9IHRvTmF0aXZlKGVudGl0eS5pZCwgJzAnLCB2aXJ0dWFsRWxlbWVudClcblxuICAgIGVudGl0eS52aXJ0dWFsRWxlbWVudCA9IHZpcnR1YWxFbGVtZW50XG4gICAgZW50aXR5Lm5hdGl2ZUVsZW1lbnQgPSBuYXRpdmVFbGVtZW50XG5cbiAgICAvLyBGaXJlIGFmdGVyUmVuZGVyIGFuZCBhZnRlck1vdW50IGhvb2tzIGF0IHRoZSBlbmRcbiAgICAvLyBvZiB0aGUgcmVuZGVyIGN5Y2xlXG4gICAgbW91bnRRdWV1ZS5wdXNoKGVudGl0eS5pZClcblxuICAgIHJldHVybiBuYXRpdmVFbGVtZW50XG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIGEgY29tcG9uZW50IGZyb20gdGhlIG5hdGl2ZSBkb20uXG4gICAqXG4gICAqIEBwYXJhbSB7RW50aXR5fSBlbnRpdHlcbiAgICovXG5cbiAgZnVuY3Rpb24gdW5tb3VudEVudGl0eSAoZW50aXR5SWQpIHtcbiAgICB2YXIgZW50aXR5ID0gZW50aXRpZXNbZW50aXR5SWRdXG4gICAgaWYgKCFlbnRpdHkpIHJldHVyblxuICAgIHRyaWdnZXIoJ2JlZm9yZVVubW91bnQnLCBlbnRpdHksIFtlbnRpdHkuY29udGV4dCwgZW50aXR5Lm5hdGl2ZUVsZW1lbnRdKVxuICAgIHVubW91bnRDaGlsZHJlbihlbnRpdHlJZClcbiAgICByZW1vdmVBbGxFdmVudHMoZW50aXR5SWQpXG4gICAgdmFyIGNvbXBvbmVudEVudGl0aWVzID0gY29tcG9uZW50c1tlbnRpdHlJZF0uZW50aXRpZXM7XG4gICAgZGVsZXRlIGNvbXBvbmVudEVudGl0aWVzW2VudGl0eUlkXVxuICAgIGRlbGV0ZSBjb21wb25lbnRzW2VudGl0eUlkXVxuICAgIGRlbGV0ZSBlbnRpdGllc1tlbnRpdHlJZF1cbiAgICBkZWxldGUgY2hpbGRyZW5bZW50aXR5SWRdXG4gIH1cblxuICAvKipcbiAgICogUmVuZGVyIHRoZSBlbnRpdHkgYW5kIG1ha2Ugc3VyZSBpdCByZXR1cm5zIGEgbm9kZVxuICAgKlxuICAgKiBAcGFyYW0ge0VudGl0eX0gZW50aXR5XG4gICAqXG4gICAqIEByZXR1cm4ge1ZpcnR1YWxUcmVlfVxuICAgKi9cblxuICBmdW5jdGlvbiByZW5kZXJFbnRpdHkgKGVudGl0eSkge1xuICAgIHZhciBjb21wb25lbnQgPSBlbnRpdHkuY29tcG9uZW50XG4gICAgdmFyIGZuID0gdHlwZW9mIGNvbXBvbmVudCA9PT0gJ2Z1bmN0aW9uJyA/IGNvbXBvbmVudCA6IGNvbXBvbmVudC5yZW5kZXJcbiAgICBpZiAoIWZuKSB0aHJvdyBuZXcgRXJyb3IoJ0NvbXBvbmVudCBuZWVkcyBhIHJlbmRlciBmdW5jdGlvbicpXG4gICAgdmFyIHJlc3VsdCA9IGZuKGVudGl0eS5jb250ZXh0LCBzZXRTdGF0ZShlbnRpdHkpKVxuICAgIGlmICghcmVzdWx0KSB0aHJvdyBuZXcgRXJyb3IoJ1JlbmRlciBmdW5jdGlvbiBtdXN0IHJldHVybiBhbiBlbGVtZW50LicpXG4gICAgcmV0dXJuIHJlc3VsdFxuICB9XG5cbiAgLyoqXG4gICAqIFdoZW5ldmVyIHNldFN0YXRlIG9yIHNldFByb3BzIGlzIGNhbGxlZCwgd2UgbWFyayB0aGUgZW50aXR5XG4gICAqIGFzIGRpcnR5IGluIHRoZSByZW5kZXJlci4gVGhpcyBsZXRzIHVzIG9wdGltaXplIHRoZSByZS1yZW5kZXJpbmdcbiAgICogYW5kIHNraXAgY29tcG9uZW50cyB0aGF0IGRlZmluaXRlbHkgaGF2ZW4ndCBjaGFuZ2VkLlxuICAgKlxuICAgKiBAcGFyYW0ge0VudGl0eX0gZW50aXR5XG4gICAqXG4gICAqIEByZXR1cm4ge0Z1bmN0aW9ufSBBIGN1cnJpZWQgZnVuY3Rpb24gZm9yIHVwZGF0aW5nIHRoZSBzdGF0ZSBvZiBhbiBlbnRpdHlcbiAgICovXG5cbiAgZnVuY3Rpb24gc2V0U3RhdGUgKGVudGl0eSkge1xuICAgIHJldHVybiBmdW5jdGlvbiAobmV4dFN0YXRlKSB7XG4gICAgICB1cGRhdGVFbnRpdHlTdGF0ZShlbnRpdHksIG5leHRTdGF0ZSlcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVGVsbCB0aGUgYXBwIGl0J3MgZGlydHkgYW5kIG5lZWRzIHRvIHJlLXJlbmRlci4gSWYgYmF0Y2hpbmcgaXMgZGlzYWJsZWRcbiAgICogd2UgY2FuIGp1c3QgdHJpZ2dlciBhIHJlbmRlciBpbW1lZGlhdGVseSwgb3RoZXJ3aXNlIHdlJ2xsIHdhaXQgdW50aWxcbiAgICogdGhlIG5leHQgYXZhaWxhYmxlIGZyYW1lLlxuICAgKi9cblxuICBmdW5jdGlvbiBpbnZhbGlkYXRlICgpIHtcbiAgICBpZiAoIW9wdGlvbnMuYmF0Y2hpbmcpIHtcbiAgICAgIGlmICghaXNSZW5kZXJpbmcpIHJlbmRlcigpXG4gICAgfSBlbHNlIHtcbiAgICAgIGlmICghZnJhbWVJZCkgZnJhbWVJZCA9IHJhZihyZW5kZXIpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSB0aGUgRE9NLiBJZiB0aGUgdXBkYXRlIGZhaWxzIHdlIHN0b3AgdGhlIGxvb3BcbiAgICogc28gd2UgZG9uJ3QgZ2V0IGVycm9ycyBvbiBldmVyeSBmcmFtZS5cbiAgICpcbiAgICogQGFwaSBwdWJsaWNcbiAgICovXG5cbiAgZnVuY3Rpb24gcmVuZGVyICgpIHtcbiAgICAvLyBJZiB0aGlzIGlzIGNhbGxlZCBzeW5jaHJvbm91c2x5IHdlIG5lZWQgdG9cbiAgICAvLyBjYW5jZWwgYW55IHBlbmRpbmcgZnV0dXJlIHVwZGF0ZXNcbiAgICBjbGVhckZyYW1lKClcblxuICAgIC8vIElmIHRoZSByZW5kZXJpbmcgZnJvbSB0aGUgcHJldmlvdXMgZnJhbWUgaXMgc3RpbGwgZ29pbmcsXG4gICAgLy8gd2UnbGwganVzdCB3YWl0IHVudGlsIHRoZSBuZXh0IGZyYW1lLiBJZGVhbGx5IHJlbmRlcnMgc2hvdWxkXG4gICAgLy8gbm90IHRha2Ugb3ZlciAxNm1zIHRvIHN0YXkgd2l0aGluIGEgc2luZ2xlIGZyYW1lLCBidXQgdGhpcyBzaG91bGRcbiAgICAvLyBjYXRjaCBpdCBpZiBpdCBkb2VzLlxuICAgIGlmIChpc1JlbmRlcmluZykge1xuICAgICAgZnJhbWVJZCA9IHJhZihyZW5kZXIpXG4gICAgICByZXR1cm5cbiAgICB9IGVsc2Uge1xuICAgICAgaXNSZW5kZXJpbmcgPSB0cnVlXG4gICAgfVxuXG4gICAgLy8gMS4gSWYgdGhlcmUgaXNuJ3QgYSBuYXRpdmUgZWxlbWVudCByZW5kZXJlZCBmb3IgdGhlIGN1cnJlbnQgbW91bnRlZCBlbGVtZW50XG4gICAgLy8gdGhlbiB3ZSBuZWVkIHRvIGNyZWF0ZSBpdCBmcm9tIHNjcmF0Y2guXG4gICAgLy8gMi4gSWYgYSBuZXcgZWxlbWVudCBoYXMgYmVlbiBtb3VudGVkLCB3ZSBzaG91bGQgZGlmZiB0aGVtLlxuICAgIC8vIDMuIFdlIHNob3VsZCB1cGRhdGUgY2hlY2sgYWxsIGNoaWxkIGNvbXBvbmVudHMgZm9yIGNoYW5nZXMuXG4gICAgaWYgKCFjdXJyZW50TmF0aXZlRWxlbWVudCkge1xuICAgICAgY3VycmVudEVsZW1lbnQgPSBhcHAuZWxlbWVudFxuICAgICAgY3VycmVudE5hdGl2ZUVsZW1lbnQgPSB0b05hdGl2ZShyb290SWQsICcwJywgY3VycmVudEVsZW1lbnQpXG4gICAgICBpZiAoY29udGFpbmVyLmNoaWxkcmVuLmxlbmd0aCA+IDApIHtcbiAgICAgICAgY29uc29sZS5pbmZvKCdkZWt1OiBUaGUgY29udGFpbmVyIGVsZW1lbnQgaXMgbm90IGVtcHR5LiBUaGVzZSBlbGVtZW50cyB3aWxsIGJlIHJlbW92ZWQuIFJlYWQgbW9yZTogaHR0cDovL2NsLmx5L2IwU3InKVxuICAgICAgfVxuICAgICAgaWYgKGNvbnRhaW5lciA9PT0gZG9jdW1lbnQuYm9keSkge1xuICAgICAgICBjb25zb2xlLndhcm4oJ2Rla3U6IFVzaW5nIGRvY3VtZW50LmJvZHkgaXMgYWxsb3dlZCBidXQgaXQgY2FuIGNhdXNlIHNvbWUgaXNzdWVzLiBSZWFkIG1vcmU6IGh0dHA6Ly9jbC5seS9iMFNDJylcbiAgICAgIH1cbiAgICAgIHJlbW92ZUFsbENoaWxkcmVuKGNvbnRhaW5lcilcbiAgICAgIGNvbnRhaW5lci5hcHBlbmRDaGlsZChjdXJyZW50TmF0aXZlRWxlbWVudClcbiAgICB9IGVsc2UgaWYgKGN1cnJlbnRFbGVtZW50ICE9PSBhcHAuZWxlbWVudCkge1xuICAgICAgY3VycmVudE5hdGl2ZUVsZW1lbnQgPSBwYXRjaChyb290SWQsIGN1cnJlbnRFbGVtZW50LCBhcHAuZWxlbWVudCwgY3VycmVudE5hdGl2ZUVsZW1lbnQpXG4gICAgICBjdXJyZW50RWxlbWVudCA9IGFwcC5lbGVtZW50XG4gICAgICB1cGRhdGVDaGlsZHJlbihyb290SWQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHVwZGF0ZUNoaWxkcmVuKHJvb3RJZClcbiAgICB9XG5cbiAgICAvLyBDYWxsIG1vdW50IGV2ZW50cyBvbiBhbGwgbmV3IGVudGl0aWVzXG4gICAgZmx1c2hNb3VudFF1ZXVlKClcblxuICAgIC8vIEFsbG93IHJlbmRlcmluZyBhZ2Fpbi5cbiAgICBpc1JlbmRlcmluZyA9IGZhbHNlXG5cbiAgfVxuXG4gIC8qKlxuICAgKiBDYWxsIGhvb2tzIGZvciBhbGwgbmV3IGVudGl0aWVzIHRoYXQgaGF2ZSBiZWVuIGNyZWF0ZWQgaW5cbiAgICogdGhlIGxhc3QgcmVuZGVyIGZyb20gdGhlIGJvdHRvbSB1cC5cbiAgICovXG5cbiAgZnVuY3Rpb24gZmx1c2hNb3VudFF1ZXVlICgpIHtcbiAgICB3aGlsZSAobW91bnRRdWV1ZS5sZW5ndGggPiAwKSB7XG4gICAgICB2YXIgZW50aXR5SWQgPSBtb3VudFF1ZXVlLnNoaWZ0KClcbiAgICAgIHZhciBlbnRpdHkgPSBlbnRpdGllc1tlbnRpdHlJZF1cbiAgICAgIHRyaWdnZXIoJ2FmdGVyUmVuZGVyJywgZW50aXR5LCBbZW50aXR5LmNvbnRleHQsIGVudGl0eS5uYXRpdmVFbGVtZW50XSlcbiAgICAgIHRyaWdnZXIoJ2FmdGVyTW91bnQnLCBlbnRpdHksIFtlbnRpdHkuY29udGV4dCwgZW50aXR5Lm5hdGl2ZUVsZW1lbnQsIHNldFN0YXRlKGVudGl0eSldKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBDbGVhciB0aGUgY3VycmVudCBzY2hlZHVsZWQgZnJhbWVcbiAgICovXG5cbiAgZnVuY3Rpb24gY2xlYXJGcmFtZSAoKSB7XG4gICAgaWYgKCFmcmFtZUlkKSByZXR1cm5cbiAgICByYWYuY2FuY2VsKGZyYW1lSWQpXG4gICAgZnJhbWVJZCA9IDBcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgYSBjb21wb25lbnQuXG4gICAqXG4gICAqIFRoZSBlbnRpdHkgaXMganVzdCB0aGUgZGF0YSBvYmplY3QgZm9yIGEgY29tcG9uZW50IGluc3RhbmNlLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gaWQgQ29tcG9uZW50IGluc3RhbmNlIGlkLlxuICAgKi9cblxuICBmdW5jdGlvbiB1cGRhdGVFbnRpdHkgKGVudGl0eUlkKSB7XG4gICAgdmFyIGVudGl0eSA9IGVudGl0aWVzW2VudGl0eUlkXVxuICAgIHNldFNvdXJjZXMoZW50aXR5KVxuXG4gICAgaWYgKCFzaG91bGRVcGRhdGUoZW50aXR5KSkge1xuICAgICAgY29tbWl0KGVudGl0eSlcbiAgICAgIHJldHVybiB1cGRhdGVDaGlsZHJlbihlbnRpdHlJZClcbiAgICB9XG5cbiAgICB2YXIgY3VycmVudFRyZWUgPSBlbnRpdHkudmlydHVhbEVsZW1lbnRcbiAgICB2YXIgbmV4dFByb3BzID0gZW50aXR5LnBlbmRpbmdQcm9wc1xuICAgIHZhciBuZXh0U3RhdGUgPSBlbnRpdHkucGVuZGluZ1N0YXRlXG4gICAgdmFyIHByZXZpb3VzU3RhdGUgPSBlbnRpdHkuY29udGV4dC5zdGF0ZVxuICAgIHZhciBwcmV2aW91c1Byb3BzID0gZW50aXR5LmNvbnRleHQucHJvcHNcblxuICAgIC8vIGhvb2sgYmVmb3JlIHJlbmRlcmluZy4gY291bGQgbW9kaWZ5IHN0YXRlIGp1c3QgYmVmb3JlIHRoZSByZW5kZXIgb2NjdXJzLlxuICAgIHRyaWdnZXIoJ2JlZm9yZVVwZGF0ZScsIGVudGl0eSwgW2VudGl0eS5jb250ZXh0LCBuZXh0UHJvcHMsIG5leHRTdGF0ZV0pXG4gICAgdHJpZ2dlcignYmVmb3JlUmVuZGVyJywgZW50aXR5LCBbZW50aXR5LmNvbnRleHRdKVxuXG4gICAgLy8gY29tbWl0IHN0YXRlIGFuZCBwcm9wcy5cbiAgICBjb21taXQoZW50aXR5KVxuXG4gICAgLy8gcmUtcmVuZGVyLlxuICAgIHZhciBuZXh0VHJlZSA9IHJlbmRlckVudGl0eShlbnRpdHkpXG5cbiAgICAvLyBpZiB0aGUgdHJlZSBpcyB0aGUgc2FtZSB3ZSBjYW4ganVzdCBza2lwIHRoaXMgY29tcG9uZW50XG4gICAgLy8gYnV0IHdlIHNob3VsZCBzdGlsbCBjaGVjayB0aGUgY2hpbGRyZW4gdG8gc2VlIGlmIHRoZXkncmUgZGlydHkuXG4gICAgLy8gVGhpcyBhbGxvd3MgdXMgdG8gbWVtb2l6ZSB0aGUgcmVuZGVyIGZ1bmN0aW9uIG9mIGNvbXBvbmVudHMuXG4gICAgaWYgKG5leHRUcmVlID09PSBjdXJyZW50VHJlZSkgcmV0dXJuIHVwZGF0ZUNoaWxkcmVuKGVudGl0eUlkKVxuXG4gICAgLy8gYXBwbHkgbmV3IHZpcnR1YWwgdHJlZSB0byBuYXRpdmUgZG9tLlxuICAgIGVudGl0eS5uYXRpdmVFbGVtZW50ID0gcGF0Y2goZW50aXR5SWQsIGN1cnJlbnRUcmVlLCBuZXh0VHJlZSwgZW50aXR5Lm5hdGl2ZUVsZW1lbnQpXG4gICAgZW50aXR5LnZpcnR1YWxFbGVtZW50ID0gbmV4dFRyZWVcbiAgICB1cGRhdGVDaGlsZHJlbihlbnRpdHlJZClcblxuICAgIC8vIHRyaWdnZXIgcmVuZGVyIGhvb2tcbiAgICB0cmlnZ2VyKCdhZnRlclJlbmRlcicsIGVudGl0eSwgW2VudGl0eS5jb250ZXh0LCBlbnRpdHkubmF0aXZlRWxlbWVudF0pXG5cbiAgICAvLyB0cmlnZ2VyIGFmdGVyVXBkYXRlIGFmdGVyIGFsbCBjaGlsZHJlbiBoYXZlIHVwZGF0ZWQuXG4gICAgdHJpZ2dlcignYWZ0ZXJVcGRhdGUnLCBlbnRpdHksIFtlbnRpdHkuY29udGV4dCwgcHJldmlvdXNQcm9wcywgcHJldmlvdXNTdGF0ZSwgc2V0U3RhdGUoZW50aXR5KV0pXG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGFsbCB0aGUgY2hpbGRyZW4gb2YgYW4gZW50aXR5LlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gaWQgQ29tcG9uZW50IGluc3RhbmNlIGlkLlxuICAgKi9cblxuICBmdW5jdGlvbiB1cGRhdGVDaGlsZHJlbiAoZW50aXR5SWQpIHtcbiAgICBmb3JFYWNoKGNoaWxkcmVuW2VudGl0eUlkXSwgZnVuY3Rpb24gKGNoaWxkSWQpIHtcbiAgICAgIHVwZGF0ZUVudGl0eShjaGlsZElkKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIGFsbCBvZiB0aGUgY2hpbGQgZW50aXRpZXMgb2YgYW4gZW50aXR5XG4gICAqXG4gICAqIEBwYXJhbSB7RW50aXR5fSBlbnRpdHlcbiAgICovXG5cbiAgZnVuY3Rpb24gdW5tb3VudENoaWxkcmVuIChlbnRpdHlJZCkge1xuICAgIGZvckVhY2goY2hpbGRyZW5bZW50aXR5SWRdLCBmdW5jdGlvbiAoY2hpbGRJZCkge1xuICAgICAgdW5tb3VudEVudGl0eShjaGlsZElkKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIHRoZSByb290IGVsZW1lbnQuIElmIHRoaXMgaXMgY2FsbGVkIHN5bmNocm9ub3VzbHkgd2UgbmVlZCB0b1xuICAgKiBjYW5jZWwgYW55IHBlbmRpbmcgZnV0dXJlIHVwZGF0ZXMuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHJlbW92ZU5hdGl2ZUVsZW1lbnQgKCkge1xuICAgIGNsZWFyRnJhbWUoKVxuICAgIHJlbW92ZUVsZW1lbnQocm9vdElkLCAnMCcsIGN1cnJlbnROYXRpdmVFbGVtZW50KVxuICAgIGN1cnJlbnROYXRpdmVFbGVtZW50ID0gbnVsbFxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIG5hdGl2ZSBlbGVtZW50IGZyb20gYSB2aXJ0dWFsIGVsZW1lbnQuXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBlbnRpdHlJZFxuICAgKiBAcGFyYW0ge1N0cmluZ30gcGF0aFxuICAgKiBAcGFyYW0ge09iamVjdH0gdm5vZGVcbiAgICpcbiAgICogQHJldHVybiB7SFRNTERvY3VtZW50RnJhZ21lbnR9XG4gICAqL1xuXG4gIGZ1bmN0aW9uIHRvTmF0aXZlIChlbnRpdHlJZCwgcGF0aCwgdm5vZGUpIHtcbiAgICBzd2l0Y2ggKG5vZGVUeXBlKHZub2RlKSkge1xuICAgICAgY2FzZSAndGV4dCc6IHJldHVybiB0b05hdGl2ZVRleHQodm5vZGUpXG4gICAgICBjYXNlICdlbXB0eSc6IHJldHVybiB0b05hdGl2ZUVtcHR5RWxlbWVudChlbnRpdHlJZCwgcGF0aClcbiAgICAgIGNhc2UgJ2VsZW1lbnQnOiByZXR1cm4gdG9OYXRpdmVFbGVtZW50KGVudGl0eUlkLCBwYXRoLCB2bm9kZSlcbiAgICAgIGNhc2UgJ2NvbXBvbmVudCc6IHJldHVybiB0b05hdGl2ZUNvbXBvbmVudChlbnRpdHlJZCwgcGF0aCwgdm5vZGUpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIG5hdGl2ZSB0ZXh0IGVsZW1lbnQgZnJvbSBhIHZpcnR1YWwgZWxlbWVudC5cbiAgICpcbiAgICogQHBhcmFtIHtPYmplY3R9IHZub2RlXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHRvTmF0aXZlVGV4dCAodGV4dCkge1xuICAgIHJldHVybiBkb2N1bWVudC5jcmVhdGVUZXh0Tm9kZSh0ZXh0KVxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIG5hdGl2ZSBlbGVtZW50IGZyb20gYSB2aXJ0dWFsIGVsZW1lbnQuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHRvTmF0aXZlRWxlbWVudCAoZW50aXR5SWQsIHBhdGgsIHZub2RlKSB7XG4gICAgdmFyIGVsXG4gICAgdmFyIGF0dHJpYnV0ZXMgPSB2bm9kZS5hdHRyaWJ1dGVzXG4gICAgdmFyIHRhZ05hbWUgPSB2bm9kZS50eXBlXG4gICAgdmFyIGNoaWxkTm9kZXMgPSB2bm9kZS5jaGlsZHJlblxuXG4gICAgLy8gY3JlYXRlIGVsZW1lbnQgZWl0aGVyIGZyb20gcG9vbCBvciBmcmVzaC5cbiAgICBpZiAoc3ZnLmlzRWxlbWVudCh0YWdOYW1lKSkge1xuICAgICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50TlMoc3ZnLm5hbWVzcGFjZSwgdGFnTmFtZSlcbiAgICB9IGVsc2Uge1xuICAgICAgZWwgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KHRhZ05hbWUpXG4gICAgfVxuXG4gICAgLy8gc2V0IGF0dHJpYnV0ZXMuXG4gICAgZm9yRWFjaChhdHRyaWJ1dGVzLCBmdW5jdGlvbiAodmFsdWUsIG5hbWUpIHtcbiAgICAgIHNldEF0dHJpYnV0ZShlbnRpdHlJZCwgcGF0aCwgZWwsIG5hbWUsIHZhbHVlKVxuICAgIH0pXG5cbiAgICAvLyBhZGQgY2hpbGRyZW4uXG4gICAgZm9yRWFjaChjaGlsZE5vZGVzLCBmdW5jdGlvbiAoY2hpbGQsIGkpIHtcbiAgICAgIHZhciBjaGlsZEVsID0gdG9OYXRpdmUoZW50aXR5SWQsIHBhdGggKyAnLicgKyBpLCBjaGlsZClcbiAgICAgIGlmICghY2hpbGRFbC5wYXJlbnROb2RlKSBlbC5hcHBlbmRDaGlsZChjaGlsZEVsKVxuICAgIH0pXG5cbiAgICAvLyBzdG9yZSBrZXlzIG9uIHRoZSBuYXRpdmUgZWxlbWVudCBmb3IgZmFzdCBldmVudCBoYW5kbGluZy5cbiAgICBlbC5fX2VudGl0eV9fID0gZW50aXR5SWRcbiAgICBlbC5fX3BhdGhfXyA9IHBhdGhcblxuICAgIHJldHVybiBlbFxuICB9XG5cbiAgLyoqXG4gICAqIENyZWF0ZSBhIG5hdGl2ZSBlbGVtZW50IGZyb20gYSB2aXJ0dWFsIGVsZW1lbnQuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHRvTmF0aXZlRW1wdHlFbGVtZW50IChlbnRpdHlJZCwgcGF0aCkge1xuICAgIHZhciBlbCA9IGRvY3VtZW50LmNyZWF0ZUVsZW1lbnQoJ25vc2NyaXB0JylcbiAgICBlbC5fX2VudGl0eV9fID0gZW50aXR5SWRcbiAgICBlbC5fX3BhdGhfXyA9IHBhdGhcbiAgICByZXR1cm4gZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYSBuYXRpdmUgZWxlbWVudCBmcm9tIGEgY29tcG9uZW50LlxuICAgKi9cblxuICBmdW5jdGlvbiB0b05hdGl2ZUNvbXBvbmVudCAoZW50aXR5SWQsIHBhdGgsIHZub2RlKSB7XG4gICAgdmFyIGNoaWxkID0gbmV3IEVudGl0eSh2bm9kZS50eXBlLCBhc3NpZ24oeyBjaGlsZHJlbjogdm5vZGUuY2hpbGRyZW4gfSwgdm5vZGUuYXR0cmlidXRlcyksIGVudGl0eUlkKVxuICAgIGNoaWxkcmVuW2VudGl0eUlkXVtwYXRoXSA9IGNoaWxkLmlkXG4gICAgcmV0dXJuIG1vdW50RW50aXR5KGNoaWxkKVxuICB9XG5cbiAgLyoqXG4gICAqIFBhdGNoIGFuIGVsZW1lbnQgd2l0aCB0aGUgZGlmZiBmcm9tIHR3byB0cmVlcy5cbiAgICovXG5cbiAgZnVuY3Rpb24gcGF0Y2ggKGVudGl0eUlkLCBwcmV2LCBuZXh0LCBlbCkge1xuICAgIHJldHVybiBkaWZmTm9kZSgnMCcsIGVudGl0eUlkLCBwcmV2LCBuZXh0LCBlbClcbiAgfVxuXG4gIC8qKlxuICAgKiBDcmVhdGUgYSBkaWZmIGJldHdlZW4gdHdvIHRyZWVzIG9mIG5vZGVzLlxuICAgKi9cblxuICBmdW5jdGlvbiBkaWZmTm9kZSAocGF0aCwgZW50aXR5SWQsIHByZXYsIG5leHQsIGVsKSB7XG4gICAgdmFyIGxlZnRUeXBlID0gbm9kZVR5cGUocHJldilcbiAgICB2YXIgcmlnaHRUeXBlID0gbm9kZVR5cGUobmV4dClcblxuICAgIC8vIFR5cGUgY2hhbmdlZC4gVGhpcyBjb3VsZCBiZSBmcm9tIGVsZW1lbnQtPnRleHQsIHRleHQtPkNvbXBvbmVudEEsXG4gICAgLy8gQ29tcG9uZW50QS0+Q29tcG9uZW50QiBldGMuIEJ1dCBOT1QgZGl2LT5zcGFuLiBUaGVzZSBhcmUgdGhlIHNhbWUgdHlwZVxuICAgIC8vIChFbGVtZW50Tm9kZSkgYnV0IGRpZmZlcmVudCB0YWcgbmFtZS5cbiAgICBpZiAobGVmdFR5cGUgIT09IHJpZ2h0VHlwZSkgcmV0dXJuIHJlcGxhY2VFbGVtZW50KGVudGl0eUlkLCBwYXRoLCBlbCwgbmV4dClcblxuICAgIHN3aXRjaCAocmlnaHRUeXBlKSB7XG4gICAgICBjYXNlICd0ZXh0JzogcmV0dXJuIGRpZmZUZXh0KHByZXYsIG5leHQsIGVsKVxuICAgICAgY2FzZSAnZW1wdHknOiByZXR1cm4gZWxcbiAgICAgIGNhc2UgJ2VsZW1lbnQnOiByZXR1cm4gZGlmZkVsZW1lbnQocGF0aCwgZW50aXR5SWQsIHByZXYsIG5leHQsIGVsKVxuICAgICAgY2FzZSAnY29tcG9uZW50JzogcmV0dXJuIGRpZmZDb21wb25lbnQocGF0aCwgZW50aXR5SWQsIHByZXYsIG5leHQsIGVsKVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBEaWZmIHR3byB0ZXh0IG5vZGVzIGFuZCB1cGRhdGUgdGhlIGVsZW1lbnQuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIGRpZmZUZXh0IChwcmV2aW91cywgY3VycmVudCwgZWwpIHtcbiAgICBpZiAoY3VycmVudCAhPT0gcHJldmlvdXMpIGVsLmRhdGEgPSBjdXJyZW50XG4gICAgcmV0dXJuIGVsXG4gIH1cblxuICAvKipcbiAgICogRGlmZiB0aGUgY2hpbGRyZW4gb2YgYW4gRWxlbWVudE5vZGUuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIGRpZmZDaGlsZHJlbiAocGF0aCwgZW50aXR5SWQsIHByZXYsIG5leHQsIGVsKSB7XG4gICAgdmFyIHBvc2l0aW9ucyA9IFtdXG4gICAgdmFyIGhhc0tleXMgPSBmYWxzZVxuICAgIHZhciBjaGlsZE5vZGVzID0gQXJyYXkucHJvdG90eXBlLnNsaWNlLmFwcGx5KGVsLmNoaWxkTm9kZXMpXG4gICAgdmFyIGxlZnRLZXlzID0gcmVkdWNlKHByZXYuY2hpbGRyZW4sIGtleU1hcFJlZHVjZXIsIHt9KVxuICAgIHZhciByaWdodEtleXMgPSByZWR1Y2UobmV4dC5jaGlsZHJlbiwga2V5TWFwUmVkdWNlciwge30pXG4gICAgdmFyIGN1cnJlbnRDaGlsZHJlbiA9IGFzc2lnbih7fSwgY2hpbGRyZW5bZW50aXR5SWRdKVxuXG4gICAgZnVuY3Rpb24ga2V5TWFwUmVkdWNlciAoYWNjLCBjaGlsZCwgaSkge1xuICAgICAgaWYgKGNoaWxkICYmIGNoaWxkLmF0dHJpYnV0ZXMgJiYgY2hpbGQuYXR0cmlidXRlcy5rZXkgIT0gbnVsbCkge1xuICAgICAgICBhY2NbY2hpbGQuYXR0cmlidXRlcy5rZXldID0ge1xuICAgICAgICAgIGVsZW1lbnQ6IGNoaWxkLFxuICAgICAgICAgIGluZGV4OiBpXG4gICAgICAgIH1cbiAgICAgICAgaGFzS2V5cyA9IHRydWVcbiAgICAgIH1cbiAgICAgIHJldHVybiBhY2NcbiAgICB9XG5cbiAgICAvLyBEaWZmIGFsbCBvZiB0aGUgbm9kZXMgdGhhdCBoYXZlIGtleXMuIFRoaXMgbGV0cyB1cyByZS11c2VkIGVsZW1lbnRzXG4gICAgLy8gaW5zdGVhZCBvZiBvdmVycmlkaW5nIHRoZW0gYW5kIGxldHMgdXMgbW92ZSB0aGVtIGFyb3VuZC5cbiAgICBpZiAoaGFzS2V5cykge1xuXG4gICAgICAvLyBSZW1vdmFsc1xuICAgICAgZm9yRWFjaChsZWZ0S2V5cywgZnVuY3Rpb24gKGxlZnROb2RlLCBrZXkpIHtcbiAgICAgICAgaWYgKHJpZ2h0S2V5c1trZXldID09IG51bGwpIHtcbiAgICAgICAgICB2YXIgbGVmdFBhdGggPSBwYXRoICsgJy4nICsgbGVmdE5vZGUuaW5kZXhcbiAgICAgICAgICByZW1vdmVFbGVtZW50KFxuICAgICAgICAgICAgZW50aXR5SWQsXG4gICAgICAgICAgICBsZWZ0UGF0aCxcbiAgICAgICAgICAgIGNoaWxkTm9kZXNbbGVmdE5vZGUuaW5kZXhdXG4gICAgICAgICAgKVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICAvLyBVcGRhdGUgbm9kZXNcbiAgICAgIGZvckVhY2gocmlnaHRLZXlzLCBmdW5jdGlvbiAocmlnaHROb2RlLCBrZXkpIHtcbiAgICAgICAgdmFyIGxlZnROb2RlID0gbGVmdEtleXNba2V5XVxuXG4gICAgICAgIC8vIFdlIG9ubHkgd2FudCB1cGRhdGVzIGZvciBub3dcbiAgICAgICAgaWYgKGxlZnROb2RlID09IG51bGwpIHJldHVyblxuXG4gICAgICAgIHZhciBsZWZ0UGF0aCA9IHBhdGggKyAnLicgKyBsZWZ0Tm9kZS5pbmRleFxuXG4gICAgICAgIC8vIFVwZGF0ZWRcbiAgICAgICAgcG9zaXRpb25zW3JpZ2h0Tm9kZS5pbmRleF0gPSBkaWZmTm9kZShcbiAgICAgICAgICBsZWZ0UGF0aCxcbiAgICAgICAgICBlbnRpdHlJZCxcbiAgICAgICAgICBsZWZ0Tm9kZS5lbGVtZW50LFxuICAgICAgICAgIHJpZ2h0Tm9kZS5lbGVtZW50LFxuICAgICAgICAgIGNoaWxkTm9kZXNbbGVmdE5vZGUuaW5kZXhdXG4gICAgICAgIClcbiAgICAgIH0pXG5cbiAgICAgIC8vIFVwZGF0ZSB0aGUgcG9zaXRpb25zIG9mIGFsbCBjaGlsZCBjb21wb25lbnRzIGFuZCBldmVudCBoYW5kbGVyc1xuICAgICAgZm9yRWFjaChyaWdodEtleXMsIGZ1bmN0aW9uIChyaWdodE5vZGUsIGtleSkge1xuICAgICAgICB2YXIgbGVmdE5vZGUgPSBsZWZ0S2V5c1trZXldXG5cbiAgICAgICAgLy8gV2UganVzdCB3YW50IGVsZW1lbnRzIHRoYXQgaGF2ZSBtb3ZlZCBhcm91bmRcbiAgICAgICAgaWYgKGxlZnROb2RlID09IG51bGwgfHwgbGVmdE5vZGUuaW5kZXggPT09IHJpZ2h0Tm9kZS5pbmRleCkgcmV0dXJuXG5cbiAgICAgICAgdmFyIHJpZ2h0UGF0aCA9IHBhdGggKyAnLicgKyByaWdodE5vZGUuaW5kZXhcbiAgICAgICAgdmFyIGxlZnRQYXRoID0gcGF0aCArICcuJyArIGxlZnROb2RlLmluZGV4XG5cbiAgICAgICAgLy8gVXBkYXRlIGFsbCB0aGUgY2hpbGQgY29tcG9uZW50IHBhdGggcG9zaXRpb25zIHRvIG1hdGNoXG4gICAgICAgIC8vIHRoZSBsYXRlc3QgcG9zaXRpb25zIGlmIHRoZXkndmUgY2hhbmdlZC4gVGhpcyBpcyBhIGJpdCBoYWNreS5cbiAgICAgICAgZm9yRWFjaChjdXJyZW50Q2hpbGRyZW4sIGZ1bmN0aW9uIChjaGlsZElkLCBjaGlsZFBhdGgpIHtcbiAgICAgICAgICBpZiAobGVmdFBhdGggPT09IGNoaWxkUGF0aCkge1xuICAgICAgICAgICAgZGVsZXRlIGNoaWxkcmVuW2VudGl0eUlkXVtjaGlsZFBhdGhdXG4gICAgICAgICAgICBjaGlsZHJlbltlbnRpdHlJZF1bcmlnaHRQYXRoXSA9IGNoaWxkSWRcbiAgICAgICAgICB9XG4gICAgICAgIH0pXG4gICAgICB9KVxuXG4gICAgICAvLyBOb3cgYWRkIGFsbCBvZiB0aGUgbmV3IG5vZGVzIGxhc3QgaW4gY2FzZSB0aGVpciBwYXRoXG4gICAgICAvLyB3b3VsZCBoYXZlIGNvbmZsaWN0ZWQgd2l0aCBvbmUgb2YgdGhlIHByZXZpb3VzIHBhdGhzLlxuICAgICAgZm9yRWFjaChyaWdodEtleXMsIGZ1bmN0aW9uIChyaWdodE5vZGUsIGtleSkge1xuICAgICAgICB2YXIgcmlnaHRQYXRoID0gcGF0aCArICcuJyArIHJpZ2h0Tm9kZS5pbmRleFxuICAgICAgICBpZiAobGVmdEtleXNba2V5XSA9PSBudWxsKSB7XG4gICAgICAgICAgcG9zaXRpb25zW3JpZ2h0Tm9kZS5pbmRleF0gPSB0b05hdGl2ZShcbiAgICAgICAgICAgIGVudGl0eUlkLFxuICAgICAgICAgICAgcmlnaHRQYXRoLFxuICAgICAgICAgICAgcmlnaHROb2RlLmVsZW1lbnRcbiAgICAgICAgICApXG4gICAgICAgIH1cbiAgICAgIH0pXG5cbiAgICB9IGVsc2Uge1xuICAgICAgdmFyIG1heExlbmd0aCA9IE1hdGgubWF4KHByZXYuY2hpbGRyZW4ubGVuZ3RoLCBuZXh0LmNoaWxkcmVuLmxlbmd0aClcblxuICAgICAgLy8gTm93IGRpZmYgYWxsIG9mIHRoZSBub2RlcyB0aGF0IGRvbid0IGhhdmUga2V5c1xuICAgICAgZm9yICh2YXIgaSA9IDA7IGkgPCBtYXhMZW5ndGg7IGkrKykge1xuICAgICAgICB2YXIgbGVmdE5vZGUgPSBwcmV2LmNoaWxkcmVuW2ldXG4gICAgICAgIHZhciByaWdodE5vZGUgPSBuZXh0LmNoaWxkcmVuW2ldXG5cbiAgICAgICAgLy8gUmVtb3ZhbHNcbiAgICAgICAgaWYgKHJpZ2h0Tm9kZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICAgICAgcmVtb3ZlRWxlbWVudChcbiAgICAgICAgICAgIGVudGl0eUlkLFxuICAgICAgICAgICAgcGF0aCArICcuJyArIGksXG4gICAgICAgICAgICBjaGlsZE5vZGVzW2ldXG4gICAgICAgICAgKVxuICAgICAgICAgIGNvbnRpbnVlXG4gICAgICAgIH1cblxuICAgICAgICAvLyBOZXcgTm9kZVxuICAgICAgICBpZiAobGVmdE5vZGUgPT09IHVuZGVmaW5lZCkge1xuICAgICAgICAgIHBvc2l0aW9uc1tpXSA9IHRvTmF0aXZlKFxuICAgICAgICAgICAgZW50aXR5SWQsXG4gICAgICAgICAgICBwYXRoICsgJy4nICsgaSxcbiAgICAgICAgICAgIHJpZ2h0Tm9kZVxuICAgICAgICAgIClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9XG5cbiAgICAgICAgLy8gVXBkYXRlZFxuICAgICAgICBwb3NpdGlvbnNbaV0gPSBkaWZmTm9kZShcbiAgICAgICAgICBwYXRoICsgJy4nICsgaSxcbiAgICAgICAgICBlbnRpdHlJZCxcbiAgICAgICAgICBsZWZ0Tm9kZSxcbiAgICAgICAgICByaWdodE5vZGUsXG4gICAgICAgICAgY2hpbGROb2Rlc1tpXVxuICAgICAgICApXG4gICAgICB9XG4gICAgfVxuXG4gICAgLy8gUmVwb3NpdGlvbiBhbGwgdGhlIGVsZW1lbnRzXG4gICAgZm9yRWFjaChwb3NpdGlvbnMsIGZ1bmN0aW9uIChjaGlsZEVsLCBuZXdQb3NpdGlvbikge1xuICAgICAgdmFyIHRhcmdldCA9IGVsLmNoaWxkTm9kZXNbbmV3UG9zaXRpb25dXG4gICAgICBpZiAoY2hpbGRFbCAmJiBjaGlsZEVsICE9PSB0YXJnZXQpIHtcbiAgICAgICAgaWYgKHRhcmdldCkge1xuICAgICAgICAgIGVsLmluc2VydEJlZm9yZShjaGlsZEVsLCB0YXJnZXQpXG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZWwuYXBwZW5kQ2hpbGQoY2hpbGRFbClcbiAgICAgICAgfVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogRGlmZiB0aGUgYXR0cmlidXRlcyBhbmQgYWRkL3JlbW92ZSB0aGVtLlxuICAgKi9cblxuICBmdW5jdGlvbiBkaWZmQXR0cmlidXRlcyAocHJldiwgbmV4dCwgZWwsIGVudGl0eUlkLCBwYXRoKSB7XG4gICAgdmFyIG5leHRBdHRycyA9IG5leHQuYXR0cmlidXRlc1xuICAgIHZhciBwcmV2QXR0cnMgPSBwcmV2LmF0dHJpYnV0ZXNcblxuICAgIC8vIGFkZCBuZXcgYXR0cnNcbiAgICBmb3JFYWNoKG5leHRBdHRycywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICBpZiAoZXZlbnRzW25hbWVdIHx8ICEobmFtZSBpbiBwcmV2QXR0cnMpIHx8IHByZXZBdHRyc1tuYW1lXSAhPT0gdmFsdWUpIHtcbiAgICAgICAgc2V0QXR0cmlidXRlKGVudGl0eUlkLCBwYXRoLCBlbCwgbmFtZSwgdmFsdWUpXG4gICAgICB9XG4gICAgfSlcblxuICAgIC8vIHJlbW92ZSBvbGQgYXR0cnNcbiAgICBmb3JFYWNoKHByZXZBdHRycywgZnVuY3Rpb24gKHZhbHVlLCBuYW1lKSB7XG4gICAgICBpZiAoIShuYW1lIGluIG5leHRBdHRycykpIHtcbiAgICAgICAgcmVtb3ZlQXR0cmlidXRlKGVudGl0eUlkLCBwYXRoLCBlbCwgbmFtZSlcbiAgICAgIH1cbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBhIGNvbXBvbmVudCB3aXRoIHRoZSBwcm9wcyBmcm9tIHRoZSBuZXh0IG5vZGUuIElmXG4gICAqIHRoZSBjb21wb25lbnQgdHlwZSBoYXMgY2hhbmdlZCwgd2UnbGwganVzdCByZW1vdmUgdGhlIG9sZCBvbmVcbiAgICogYW5kIHJlcGxhY2UgaXQgd2l0aCB0aGUgbmV3IGNvbXBvbmVudC5cbiAgICovXG5cbiAgZnVuY3Rpb24gZGlmZkNvbXBvbmVudCAocGF0aCwgZW50aXR5SWQsIHByZXYsIG5leHQsIGVsKSB7XG4gICAgaWYgKG5leHQudHlwZSAhPT0gcHJldi50eXBlKSB7XG4gICAgICByZXR1cm4gcmVwbGFjZUVsZW1lbnQoZW50aXR5SWQsIHBhdGgsIGVsLCBuZXh0KVxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgdGFyZ2V0SWQgPSBjaGlsZHJlbltlbnRpdHlJZF1bcGF0aF1cblxuICAgICAgLy8gVGhpcyBpcyBhIGhhY2sgZm9yIG5vd1xuICAgICAgaWYgKHRhcmdldElkKSB7XG4gICAgICAgIHVwZGF0ZUVudGl0eVByb3BzKHRhcmdldElkLCBhc3NpZ24oeyBjaGlsZHJlbjogbmV4dC5jaGlsZHJlbiB9LCBuZXh0LmF0dHJpYnV0ZXMpKVxuICAgICAgfVxuXG4gICAgICByZXR1cm4gZWxcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogRGlmZiB0d28gZWxlbWVudCBub2Rlcy5cbiAgICovXG5cbiAgZnVuY3Rpb24gZGlmZkVsZW1lbnQgKHBhdGgsIGVudGl0eUlkLCBwcmV2LCBuZXh0LCBlbCkge1xuICAgIGlmIChuZXh0LnR5cGUgIT09IHByZXYudHlwZSkgcmV0dXJuIHJlcGxhY2VFbGVtZW50KGVudGl0eUlkLCBwYXRoLCBlbCwgbmV4dClcbiAgICBkaWZmQXR0cmlidXRlcyhwcmV2LCBuZXh0LCBlbCwgZW50aXR5SWQsIHBhdGgpXG4gICAgZGlmZkNoaWxkcmVuKHBhdGgsIGVudGl0eUlkLCBwcmV2LCBuZXh0LCBlbClcbiAgICByZXR1cm4gZWxcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGFuIGVsZW1lbnQgZnJvbSB0aGUgRE9NIGFuZCB1bm1vdW50cyBhbmQgY29tcG9uZW50c1xuICAgKiB0aGF0IGFyZSB3aXRoaW4gdGhhdCBicmFuY2hcbiAgICpcbiAgICogc2lkZSBlZmZlY3RzOlxuICAgKiAgIC0gcmVtb3ZlcyBlbGVtZW50IGZyb20gdGhlIERPTVxuICAgKiAgIC0gcmVtb3ZlcyBpbnRlcm5hbCByZWZlcmVuY2VzXG4gICAqXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBlbnRpdHlJZFxuICAgKiBAcGFyYW0ge1N0cmluZ30gcGF0aFxuICAgKiBAcGFyYW0ge0hUTUxFbGVtZW50fSBlbFxuICAgKi9cblxuICBmdW5jdGlvbiByZW1vdmVFbGVtZW50IChlbnRpdHlJZCwgcGF0aCwgZWwpIHtcbiAgICB2YXIgY2hpbGRyZW5CeVBhdGggPSBjaGlsZHJlbltlbnRpdHlJZF1cbiAgICB2YXIgY2hpbGRJZCA9IGNoaWxkcmVuQnlQYXRoW3BhdGhdXG4gICAgdmFyIGVudGl0eUhhbmRsZXJzID0gaGFuZGxlcnNbZW50aXR5SWRdIHx8IHt9XG4gICAgdmFyIHJlbW92YWxzID0gW11cblxuICAgIC8vIElmIHRoZSBwYXRoIHBvaW50cyB0byBhIGNvbXBvbmVudCB3ZSBzaG91bGQgdXNlIHRoYXRcbiAgICAvLyBjb21wb25lbnRzIGVsZW1lbnQgaW5zdGVhZCwgYmVjYXVzZSBpdCBtaWdodCBoYXZlIG1vdmVkIGl0LlxuICAgIGlmIChjaGlsZElkKSB7XG4gICAgICB2YXIgY2hpbGQgPSBlbnRpdGllc1tjaGlsZElkXVxuICAgICAgZWwgPSBjaGlsZC5uYXRpdmVFbGVtZW50XG4gICAgICB1bm1vdW50RW50aXR5KGNoaWxkSWQpXG4gICAgICByZW1vdmFscy5wdXNoKHBhdGgpXG4gICAgfSBlbHNlIHtcblxuICAgICAgLy8gSnVzdCByZW1vdmUgdGhlIHRleHQgbm9kZVxuICAgICAgaWYgKCFpc0VsZW1lbnQoZWwpKSByZXR1cm4gZWwgJiYgZWwucGFyZW50Tm9kZS5yZW1vdmVDaGlsZChlbClcblxuICAgICAgLy8gVGhlbiB3ZSBuZWVkIHRvIGZpbmQgYW55IGNvbXBvbmVudHMgd2l0aGluIHRoaXNcbiAgICAgIC8vIGJyYW5jaCBhbmQgdW5tb3VudCB0aGVtLlxuICAgICAgZm9yRWFjaChjaGlsZHJlbkJ5UGF0aCwgZnVuY3Rpb24gKGNoaWxkSWQsIGNoaWxkUGF0aCkge1xuICAgICAgICBpZiAoY2hpbGRQYXRoID09PSBwYXRoIHx8IGlzV2l0aGluUGF0aChwYXRoLCBjaGlsZFBhdGgpKSB7XG4gICAgICAgICAgdW5tb3VudEVudGl0eShjaGlsZElkKVxuICAgICAgICAgIHJlbW92YWxzLnB1c2goY2hpbGRQYXRoKVxuICAgICAgICB9XG4gICAgICB9KVxuXG4gICAgICAvLyBSZW1vdmUgYWxsIGV2ZW50cyBhdCB0aGlzIHBhdGggb3IgYmVsb3cgaXRcbiAgICAgIGZvckVhY2goZW50aXR5SGFuZGxlcnMsIGZ1bmN0aW9uIChmbiwgaGFuZGxlclBhdGgpIHtcbiAgICAgICAgaWYgKGhhbmRsZXJQYXRoID09PSBwYXRoIHx8IGlzV2l0aGluUGF0aChwYXRoLCBoYW5kbGVyUGF0aCkpIHtcbiAgICAgICAgICByZW1vdmVFdmVudChlbnRpdHlJZCwgaGFuZGxlclBhdGgpXG4gICAgICAgIH1cbiAgICAgIH0pXG4gICAgfVxuXG4gICAgLy8gUmVtb3ZlIHRoZSBwYXRocyBmcm9tIHRoZSBvYmplY3Qgd2l0aG91dCB0b3VjaGluZyB0aGVcbiAgICAvLyBvbGQgb2JqZWN0LiBUaGlzIGtlZXBzIHRoZSBvYmplY3QgdXNpbmcgZmFzdCBwcm9wZXJ0aWVzLlxuICAgIGZvckVhY2gocmVtb3ZhbHMsIGZ1bmN0aW9uIChwYXRoKSB7XG4gICAgICBkZWxldGUgY2hpbGRyZW5bZW50aXR5SWRdW3BhdGhdXG4gICAgfSlcblxuICAgIC8vIFJlbW92ZSBpdCBmcm9tIHRoZSBET01cbiAgICBlbC5wYXJlbnROb2RlLnJlbW92ZUNoaWxkKGVsKVxuICB9XG5cbiAgLyoqXG4gICAqIFJlcGxhY2UgYW4gZWxlbWVudCBpbiB0aGUgRE9NLiBSZW1vdmluZyBhbGwgY29tcG9uZW50c1xuICAgKiB3aXRoaW4gdGhhdCBlbGVtZW50IGFuZCByZS1yZW5kZXJpbmcgdGhlIG5ldyB2aXJ0dWFsIG5vZGUuXG4gICAqXG4gICAqIEBwYXJhbSB7RW50aXR5fSBlbnRpdHlcbiAgICogQHBhcmFtIHtTdHJpbmd9IHBhdGhcbiAgICogQHBhcmFtIHtIVE1MRWxlbWVudH0gZWxcbiAgICogQHBhcmFtIHtPYmplY3R9IHZub2RlXG4gICAqXG4gICAqIEByZXR1cm4ge3ZvaWR9XG4gICAqL1xuXG4gIGZ1bmN0aW9uIHJlcGxhY2VFbGVtZW50IChlbnRpdHlJZCwgcGF0aCwgZWwsIHZub2RlKSB7XG4gICAgdmFyIHBhcmVudCA9IGVsLnBhcmVudE5vZGVcbiAgICB2YXIgaW5kZXggPSBBcnJheS5wcm90b3R5cGUuaW5kZXhPZi5jYWxsKHBhcmVudC5jaGlsZE5vZGVzLCBlbClcblxuICAgIC8vIHJlbW92ZSB0aGUgcHJldmlvdXMgZWxlbWVudCBhbmQgYWxsIG5lc3RlZCBjb21wb25lbnRzLiBUaGlzXG4gICAgLy8gbmVlZHMgdG8gaGFwcGVuIGJlZm9yZSB3ZSBjcmVhdGUgdGhlIG5ldyBlbGVtZW50IHNvIHdlIGRvbid0XG4gICAgLy8gZ2V0IGNsYXNoZXMgb24gdGhlIGNvbXBvbmVudCBwYXRocy5cbiAgICByZW1vdmVFbGVtZW50KGVudGl0eUlkLCBwYXRoLCBlbClcblxuICAgIC8vIHRoZW4gYWRkIHRoZSBuZXcgZWxlbWVudCBpbiB0aGVyZVxuICAgIHZhciBuZXdFbCA9IHRvTmF0aXZlKGVudGl0eUlkLCBwYXRoLCB2bm9kZSlcbiAgICB2YXIgdGFyZ2V0ID0gcGFyZW50LmNoaWxkTm9kZXNbaW5kZXhdXG5cbiAgICBpZiAodGFyZ2V0KSB7XG4gICAgICBwYXJlbnQuaW5zZXJ0QmVmb3JlKG5ld0VsLCB0YXJnZXQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHBhcmVudC5hcHBlbmRDaGlsZChuZXdFbClcbiAgICB9XG5cbiAgICAvLyB3YWxrIHVwIHRoZSB0cmVlIGFuZCB1cGRhdGUgYWxsIGBlbnRpdHkubmF0aXZlRWxlbWVudGAgcmVmZXJlbmNlcy5cbiAgICBpZiAoZW50aXR5SWQgIT09ICdyb290JyAmJiBwYXRoID09PSAnMCcpIHtcbiAgICAgIHVwZGF0ZU5hdGl2ZUVsZW1lbnQoZW50aXR5SWQsIG5ld0VsKVxuICAgIH1cblxuICAgIHJldHVybiBuZXdFbFxuICB9XG5cbiAgLyoqXG4gICAqIFVwZGF0ZSBhbGwgZW50aXRpZXMgaW4gYSBicmFuY2ggdGhhdCBoYXZlIHRoZSBzYW1lIG5hdGl2ZUVsZW1lbnQuIFRoaXNcbiAgICogaGFwcGVucyB3aGVuIGEgY29tcG9uZW50IGhhcyBhbm90aGVyIGNvbXBvbmVudCBhcyBpdCdzIHJvb3Qgbm9kZS5cbiAgICpcbiAgICogQHBhcmFtIHtTdHJpbmd9IGVudGl0eUlkXG4gICAqIEBwYXJhbSB7SFRNTEVsZW1lbnR9IG5ld0VsXG4gICAqXG4gICAqIEByZXR1cm4ge3ZvaWR9XG4gICAqL1xuXG4gIGZ1bmN0aW9uIHVwZGF0ZU5hdGl2ZUVsZW1lbnQgKGVudGl0eUlkLCBuZXdFbCkge1xuICAgIHZhciB0YXJnZXQgPSBlbnRpdGllc1tlbnRpdHlJZF1cbiAgICBpZiAodGFyZ2V0Lm93bmVySWQgPT09ICdyb290JykgcmV0dXJuXG4gICAgaWYgKGNoaWxkcmVuW3RhcmdldC5vd25lcklkXVsnMCddID09PSBlbnRpdHlJZCkge1xuICAgICAgZW50aXRpZXNbdGFyZ2V0Lm93bmVySWRdLm5hdGl2ZUVsZW1lbnQgPSBuZXdFbFxuICAgICAgdXBkYXRlTmF0aXZlRWxlbWVudCh0YXJnZXQub3duZXJJZCwgbmV3RWwpXG4gICAgfVxuICB9XG5cbiAgLyoqXG4gICAqIFNldCB0aGUgYXR0cmlidXRlIG9mIGFuIGVsZW1lbnQsIHBlcmZvcm1pbmcgYWRkaXRpb25hbCB0cmFuc2Zvcm1hdGlvbnNcbiAgICogZGVwZW5kbmluZyBvbiB0aGUgYXR0cmlidXRlIG5hbWVcbiAgICpcbiAgICogQHBhcmFtIHtIVE1MRWxlbWVudH0gZWxcbiAgICogQHBhcmFtIHtTdHJpbmd9IG5hbWVcbiAgICogQHBhcmFtIHtTdHJpbmd9IHZhbHVlXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHNldEF0dHJpYnV0ZSAoZW50aXR5SWQsIHBhdGgsIGVsLCBuYW1lLCB2YWx1ZSkge1xuICAgIGlmICghdmFsdWUpIHtcbiAgICAgIHJlbW92ZUF0dHJpYnV0ZShlbnRpdHlJZCwgcGF0aCwgZWwsIG5hbWUpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgaWYgKGV2ZW50c1tuYW1lXSkge1xuICAgICAgYWRkRXZlbnQoZW50aXR5SWQsIHBhdGgsIGV2ZW50c1tuYW1lXSwgdmFsdWUpXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgc3dpdGNoIChuYW1lKSB7XG4gICAgICBjYXNlICdjaGVja2VkJzpcbiAgICAgIGNhc2UgJ2Rpc2FibGVkJzpcbiAgICAgIGNhc2UgJ3NlbGVjdGVkJzpcbiAgICAgICAgZWxbbmFtZV0gPSB0cnVlXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdpbm5lckhUTUwnOlxuICAgICAgICBlbC5pbm5lckhUTUwgPSB2YWx1ZVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSAndmFsdWUnOlxuICAgICAgICBzZXRFbGVtZW50VmFsdWUoZWwsIHZhbHVlKVxuICAgICAgICBicmVha1xuICAgICAgY2FzZSBzdmcuaXNBdHRyaWJ1dGUobmFtZSk6XG4gICAgICAgIGVsLnNldEF0dHJpYnV0ZU5TKHN2Zy5uYW1lc3BhY2UsIG5hbWUsIHZhbHVlKVxuICAgICAgICBicmVha1xuICAgICAgZGVmYXVsdDpcbiAgICAgICAgZWwuc2V0QXR0cmlidXRlKG5hbWUsIHZhbHVlKVxuICAgICAgICBicmVha1xuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZW1vdmUgYW4gYXR0cmlidXRlLCBwZXJmb3JtaW5nIGFkZGl0aW9uYWwgdHJhbnNmb3JtYXRpb25zXG4gICAqIGRlcGVuZG5pbmcgb24gdGhlIGF0dHJpYnV0ZSBuYW1lXG4gICAqXG4gICAqIEBwYXJhbSB7SFRNTEVsZW1lbnR9IGVsXG4gICAqIEBwYXJhbSB7U3RyaW5nfSBuYW1lXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHJlbW92ZUF0dHJpYnV0ZSAoZW50aXR5SWQsIHBhdGgsIGVsLCBuYW1lKSB7XG4gICAgaWYgKGV2ZW50c1tuYW1lXSkge1xuICAgICAgcmVtb3ZlRXZlbnQoZW50aXR5SWQsIHBhdGgsIGV2ZW50c1tuYW1lXSlcbiAgICAgIHJldHVyblxuICAgIH1cbiAgICBzd2l0Y2ggKG5hbWUpIHtcbiAgICAgIGNhc2UgJ2NoZWNrZWQnOlxuICAgICAgY2FzZSAnZGlzYWJsZWQnOlxuICAgICAgY2FzZSAnc2VsZWN0ZWQnOlxuICAgICAgICBlbFtuYW1lXSA9IGZhbHNlXG4gICAgICAgIGJyZWFrXG4gICAgICBjYXNlICdpbm5lckhUTUwnOlxuICAgICAgICBlbC5pbm5lckhUTUwgPSAnJ1xuICAgICAgY2FzZSAndmFsdWUnOlxuICAgICAgICBzZXRFbGVtZW50VmFsdWUoZWwsIG51bGwpXG4gICAgICAgIGJyZWFrXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBlbC5yZW1vdmVBdHRyaWJ1dGUobmFtZSlcbiAgICAgICAgYnJlYWtcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogQ2hlY2tzIHRvIHNlZSBpZiBvbmUgdHJlZSBwYXRoIGlzIHdpdGhpblxuICAgKiBhbm90aGVyIHRyZWUgcGF0aC4gRXhhbXBsZTpcbiAgICpcbiAgICogMC4xIHZzIDAuMS4xID0gdHJ1ZVxuICAgKiAwLjIgdnMgMC4zLjUgPSBmYWxzZVxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gdGFyZ2V0XG4gICAqIEBwYXJhbSB7U3RyaW5nfSBwYXRoXG4gICAqXG4gICAqIEByZXR1cm4ge0Jvb2xlYW59XG4gICAqL1xuXG4gIGZ1bmN0aW9uIGlzV2l0aGluUGF0aCAodGFyZ2V0LCBwYXRoKSB7XG4gICAgcmV0dXJuIHBhdGguaW5kZXhPZih0YXJnZXQgKyAnLicpID09PSAwXG4gIH1cblxuICAvKipcbiAgICogSXMgdGhlIERPTSBub2RlIGFuIGVsZW1lbnQgbm9kZVxuICAgKlxuICAgKiBAcGFyYW0ge0hUTUxFbGVtZW50fSBlbFxuICAgKlxuICAgKiBAcmV0dXJuIHtCb29sZWFufVxuICAgKi9cblxuICBmdW5jdGlvbiBpc0VsZW1lbnQgKGVsKSB7XG4gICAgcmV0dXJuICEhKGVsICYmIGVsLnRhZ05hbWUpXG4gIH1cblxuICAvKipcbiAgICogUmVtb3ZlIGFsbCB0aGUgY2hpbGQgbm9kZXMgZnJvbSBhbiBlbGVtZW50XG4gICAqXG4gICAqIEBwYXJhbSB7SFRNTEVsZW1lbnR9IGVsXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHJlbW92ZUFsbENoaWxkcmVuIChlbCkge1xuICAgIHdoaWxlIChlbC5maXJzdENoaWxkKSBlbC5yZW1vdmVDaGlsZChlbC5maXJzdENoaWxkKVxuICB9XG5cbiAgLyoqXG4gICAqIFRyaWdnZXIgYSBob29rIG9uIGEgY29tcG9uZW50LlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gbmFtZSBOYW1lIG9mIGhvb2suXG4gICAqIEBwYXJhbSB7RW50aXR5fSBlbnRpdHkgVGhlIGNvbXBvbmVudCBpbnN0YW5jZS5cbiAgICogQHBhcmFtIHtBcnJheX0gYXJncyBUbyBwYXNzIGFsb25nIHRvIGhvb2suXG4gICAqL1xuXG4gIGZ1bmN0aW9uIHRyaWdnZXIgKG5hbWUsIGVudGl0eSwgYXJncykge1xuICAgIGlmICh0eXBlb2YgZW50aXR5LmNvbXBvbmVudFtuYW1lXSAhPT0gJ2Z1bmN0aW9uJykgcmV0dXJuXG4gICAgcmV0dXJuIGVudGl0eS5jb21wb25lbnRbbmFtZV0uYXBwbHkobnVsbCwgYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBVcGRhdGUgYW4gZW50aXR5IHRvIG1hdGNoIHRoZSBsYXRlc3QgcmVuZGVyZWQgdm9kZS4gV2UgYWx3YXlzXG4gICAqIHJlcGxhY2UgdGhlIHByb3BzIG9uIHRoZSBjb21wb25lbnQgd2hlbiBjb21wb3NpbmcgdGhlbS4gVGhpc1xuICAgKiB3aWxsIHRyaWdnZXIgYSByZS1yZW5kZXIgb24gYWxsIGNoaWxkcmVuIGJlbG93IHRoaXMgcG9pbnQuXG4gICAqXG4gICAqIEBwYXJhbSB7RW50aXR5fSBlbnRpdHlcbiAgICogQHBhcmFtIHtTdHJpbmd9IHBhdGhcbiAgICogQHBhcmFtIHtPYmplY3R9IHZub2RlXG4gICAqXG4gICAqIEByZXR1cm4ge3ZvaWR9XG4gICAqL1xuXG4gIGZ1bmN0aW9uIHVwZGF0ZUVudGl0eVByb3BzIChlbnRpdHlJZCwgbmV4dFByb3BzKSB7XG4gICAgdmFyIGVudGl0eSA9IGVudGl0aWVzW2VudGl0eUlkXVxuICAgIGVudGl0eS5wZW5kaW5nUHJvcHMgPSBkZWZhdWx0cyh7fSwgbmV4dFByb3BzLCBlbnRpdHkuY29tcG9uZW50LmRlZmF1bHRQcm9wcyB8fCB7fSlcbiAgICBlbnRpdHkuZGlydHkgPSB0cnVlXG4gICAgaW52YWxpZGF0ZSgpXG4gIH1cblxuICAvKipcbiAgICogVXBkYXRlIGNvbXBvbmVudCBpbnN0YW5jZSBzdGF0ZS5cbiAgICovXG5cbiAgZnVuY3Rpb24gdXBkYXRlRW50aXR5U3RhdGUgKGVudGl0eSwgbmV4dFN0YXRlKSB7XG4gICAgZW50aXR5LnBlbmRpbmdTdGF0ZSA9IGFzc2lnbihlbnRpdHkucGVuZGluZ1N0YXRlLCBuZXh0U3RhdGUpXG4gICAgZW50aXR5LmRpcnR5ID0gdHJ1ZVxuICAgIGludmFsaWRhdGUoKVxuICB9XG5cbiAgLyoqXG4gICAqIENvbW1pdCBwcm9wcyBhbmQgc3RhdGUgY2hhbmdlcyB0byBhbiBlbnRpdHkuXG4gICAqL1xuXG4gIGZ1bmN0aW9uIGNvbW1pdCAoZW50aXR5KSB7XG4gICAgZW50aXR5LmNvbnRleHQgPSB7XG4gICAgICBzdGF0ZTogZW50aXR5LnBlbmRpbmdTdGF0ZSxcbiAgICAgIHByb3BzOiBlbnRpdHkucGVuZGluZ1Byb3BzLFxuICAgICAgaWQ6IGVudGl0eS5pZFxuICAgIH1cbiAgICBlbnRpdHkucGVuZGluZ1N0YXRlID0gYXNzaWduKHt9LCBlbnRpdHkuY29udGV4dC5zdGF0ZSlcbiAgICBlbnRpdHkucGVuZGluZ1Byb3BzID0gYXNzaWduKHt9LCBlbnRpdHkuY29udGV4dC5wcm9wcylcbiAgICBlbnRpdHkuZGlydHkgPSBmYWxzZVxuICAgIGlmICh0eXBlb2YgZW50aXR5LmNvbXBvbmVudC52YWxpZGF0ZSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgZW50aXR5LmNvbXBvbmVudC52YWxpZGF0ZShlbnRpdHkuY29udGV4dClcbiAgICB9XG4gIH1cblxuICAvKipcbiAgICogVHJ5IHRvIGF2b2lkIGNyZWF0aW5nIG5ldyB2aXJ0dWFsIGRvbSBpZiBwb3NzaWJsZS5cbiAgICpcbiAgICogTGF0ZXIgd2UgbWF5IGV4cG9zZSB0aGlzIHNvIHlvdSBjYW4gb3ZlcnJpZGUsIGJ1dCBub3QgdGhlcmUgeWV0LlxuICAgKi9cblxuICBmdW5jdGlvbiBzaG91bGRVcGRhdGUgKGVudGl0eSkge1xuICAgIGlmICghZW50aXR5LmRpcnR5KSByZXR1cm4gZmFsc2VcbiAgICBpZiAoIWVudGl0eS5jb21wb25lbnQuc2hvdWxkVXBkYXRlKSByZXR1cm4gdHJ1ZVxuICAgIHZhciBuZXh0UHJvcHMgPSBlbnRpdHkucGVuZGluZ1Byb3BzXG4gICAgdmFyIG5leHRTdGF0ZSA9IGVudGl0eS5wZW5kaW5nU3RhdGVcbiAgICB2YXIgYm9vbCA9IGVudGl0eS5jb21wb25lbnQuc2hvdWxkVXBkYXRlKGVudGl0eS5jb250ZXh0LCBuZXh0UHJvcHMsIG5leHRTdGF0ZSlcbiAgICByZXR1cm4gYm9vbFxuICB9XG5cbiAgLyoqXG4gICAqIFJlZ2lzdGVyIGFuIGVudGl0eS5cbiAgICpcbiAgICogVGhpcyBpcyBtb3N0bHkgdG8gcHJlLXByZXByb2Nlc3MgY29tcG9uZW50IHByb3BlcnRpZXMgYW5kIHZhbHVlcyBjaGFpbnMuXG4gICAqXG4gICAqIFRoZSBlbmQgcmVzdWx0IGlzIGZvciBldmVyeSBjb21wb25lbnQgdGhhdCBnZXRzIG1vdW50ZWQsXG4gICAqIHlvdSBjcmVhdGUgYSBzZXQgb2YgSU8gbm9kZXMgaW4gdGhlIG5ldHdvcmsgZnJvbSB0aGUgYHZhbHVlYCBkZWZpbml0aW9ucy5cbiAgICpcbiAgICogQHBhcmFtIHtDb21wb25lbnR9IGNvbXBvbmVudFxuICAgKi9cblxuICBmdW5jdGlvbiByZWdpc3RlciAoZW50aXR5KSB7XG4gICAgcmVnaXN0ZXJFbnRpdHkoZW50aXR5KVxuICAgIHZhciBjb21wb25lbnQgPSBlbnRpdHkuY29tcG9uZW50XG4gICAgaWYgKGNvbXBvbmVudC5yZWdpc3RlcmVkKSByZXR1cm5cblxuICAgIC8vIGluaXRpYWxpemUgc291cmNlcyBvbmNlIGZvciBhIGNvbXBvbmVudCB0eXBlLlxuICAgIHJlZ2lzdGVyU291cmNlcyhlbnRpdHkpXG4gICAgY29tcG9uZW50LnJlZ2lzdGVyZWQgPSB0cnVlXG4gIH1cblxuICAvKipcbiAgICogQWRkIGVudGl0eSB0byBkYXRhLXN0cnVjdHVyZXMgcmVsYXRlZCB0byBjb21wb25lbnRzL2VudGl0aWVzLlxuICAgKlxuICAgKiBAcGFyYW0ge0VudGl0eX0gZW50aXR5XG4gICAqL1xuXG4gIGZ1bmN0aW9uIHJlZ2lzdGVyRW50aXR5KGVudGl0eSkge1xuICAgIHZhciBjb21wb25lbnQgPSBlbnRpdHkuY29tcG9uZW50XG4gICAgLy8gYWxsIGVudGl0aWVzIGZvciB0aGlzIGNvbXBvbmVudCB0eXBlLlxuICAgIHZhciBlbnRpdGllcyA9IGNvbXBvbmVudC5lbnRpdGllcyA9IGNvbXBvbmVudC5lbnRpdGllcyB8fCB7fVxuICAgIC8vIGFkZCBlbnRpdHkgdG8gY29tcG9uZW50IGxpc3RcbiAgICBlbnRpdGllc1tlbnRpdHkuaWRdID0gZW50aXR5XG4gICAgLy8gbWFwIHRvIGNvbXBvbmVudCBzbyB5b3UgY2FuIHJlbW92ZSBsYXRlci5cbiAgICBjb21wb25lbnRzW2VudGl0eS5pZF0gPSBjb21wb25lbnRcbiAgfVxuXG4gIC8qKlxuICAgKiBJbml0aWFsaXplIHNvdXJjZXMgZm9yIGEgY29tcG9uZW50IGJ5IHR5cGUuXG4gICAqXG4gICAqIEBwYXJhbSB7RW50aXR5fSBlbnRpdHlcbiAgICovXG5cbiAgZnVuY3Rpb24gcmVnaXN0ZXJTb3VyY2VzKGVudGl0eSkge1xuICAgIHZhciBjb21wb25lbnQgPSBjb21wb25lbnRzW2VudGl0eS5pZF1cbiAgICAvLyBnZXQgJ2NsYXNzLWxldmVsJyBzb3VyY2VzLlxuICAgIC8vIGlmIHdlJ3ZlIGFscmVhZHkgaG9va2VkIGl0IHVwLCB0aGVuIHdlJ3JlIGdvb2QuXG4gICAgdmFyIHNvdXJjZXMgPSBjb21wb25lbnQuc291cmNlc1xuICAgIGlmIChzb3VyY2VzKSByZXR1cm5cbiAgICB2YXIgZW50aXRpZXMgPSBjb21wb25lbnQuZW50aXRpZXNcblxuICAgIC8vIGhvb2sgdXAgc291cmNlcy5cbiAgICB2YXIgbWFwID0gY29tcG9uZW50LnNvdXJjZVRvUHJvcGVydHlOYW1lID0ge31cbiAgICBjb21wb25lbnQuc291cmNlcyA9IHNvdXJjZXMgPSBbXVxuICAgIHZhciBwcm9wVHlwZXMgPSBjb21wb25lbnQucHJvcFR5cGVzXG4gICAgZm9yICh2YXIgbmFtZSBpbiBwcm9wVHlwZXMpIHtcbiAgICAgIHZhciBkYXRhID0gcHJvcFR5cGVzW25hbWVdXG4gICAgICBpZiAoIWRhdGEpIGNvbnRpbnVlXG4gICAgICBpZiAoIWRhdGEuc291cmNlKSBjb250aW51ZVxuICAgICAgc291cmNlcy5wdXNoKGRhdGEuc291cmNlKVxuICAgICAgbWFwW2RhdGEuc291cmNlXSA9IG5hbWVcbiAgICB9XG5cbiAgICAvLyBzZW5kIHZhbHVlIHVwZGF0ZXMgdG8gYWxsIGNvbXBvbmVudCBpbnN0YW5jZXMuXG4gICAgc291cmNlcy5mb3JFYWNoKGZ1bmN0aW9uIChzb3VyY2UpIHtcbiAgICAgIGNvbm5lY3Rpb25zW3NvdXJjZV0gPSBjb25uZWN0aW9uc1tzb3VyY2VdIHx8IFtdXG4gICAgICBjb25uZWN0aW9uc1tzb3VyY2VdLnB1c2godXBkYXRlKVxuXG4gICAgICBmdW5jdGlvbiB1cGRhdGUgKGRhdGEpIHtcbiAgICAgICAgdmFyIHByb3AgPSBtYXBbc291cmNlXVxuICAgICAgICBmb3IgKHZhciBlbnRpdHlJZCBpbiBlbnRpdGllcykge1xuICAgICAgICAgIHZhciBlbnRpdHkgPSBlbnRpdGllc1tlbnRpdHlJZF1cbiAgICAgICAgICB2YXIgY2hhbmdlcyA9IHt9XG4gICAgICAgICAgY2hhbmdlc1twcm9wXSA9IGRhdGFcbiAgICAgICAgICB1cGRhdGVFbnRpdHlQcm9wcyhlbnRpdHlJZCwgYXNzaWduKGVudGl0eS5wZW5kaW5nUHJvcHMsIGNoYW5nZXMpKVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBTZXQgdGhlIGluaXRpYWwgc291cmNlIHZhbHVlIG9uIHRoZSBlbnRpdHlcbiAgICpcbiAgICogQHBhcmFtIHtFbnRpdHl9IGVudGl0eVxuICAgKi9cblxuICBmdW5jdGlvbiBzZXRTb3VyY2VzIChlbnRpdHkpIHtcbiAgICB2YXIgY29tcG9uZW50ID0gZW50aXR5LmNvbXBvbmVudFxuICAgIHZhciBtYXAgPSBjb21wb25lbnQuc291cmNlVG9Qcm9wZXJ0eU5hbWVcbiAgICB2YXIgc291cmNlcyA9IGNvbXBvbmVudC5zb3VyY2VzXG4gICAgc291cmNlcy5mb3JFYWNoKGZ1bmN0aW9uIChzb3VyY2UpIHtcbiAgICAgIHZhciBuYW1lID0gbWFwW3NvdXJjZV1cbiAgICAgIGlmIChlbnRpdHkucGVuZGluZ1Byb3BzW25hbWVdICE9IG51bGwpIHJldHVyblxuICAgICAgZW50aXR5LnBlbmRpbmdQcm9wc1tuYW1lXSA9IGFwcC5zb3VyY2VzW3NvdXJjZV0gLy8gZ2V0IGxhdGVzdCB2YWx1ZSBwbHVnZ2VkIGludG8gZ2xvYmFsIHN0b3JlXG4gICAgfSlcbiAgfVxuXG4gIC8qKlxuICAgKiBBZGQgYWxsIG9mIHRoZSBET00gZXZlbnQgbGlzdGVuZXJzXG4gICAqL1xuXG4gIGZ1bmN0aW9uIGFkZE5hdGl2ZUV2ZW50TGlzdGVuZXJzICgpIHtcbiAgICBmb3JFYWNoKGV2ZW50cywgZnVuY3Rpb24gKGV2ZW50VHlwZSkge1xuICAgICAgcm9vdEVsZW1lbnQuYWRkRXZlbnRMaXN0ZW5lcihldmVudFR5cGUsIGhhbmRsZUV2ZW50LCB0cnVlKVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogQWRkIGFsbCBvZiB0aGUgRE9NIGV2ZW50IGxpc3RlbmVyc1xuICAgKi9cblxuICBmdW5jdGlvbiByZW1vdmVOYXRpdmVFdmVudExpc3RlbmVycyAoKSB7XG4gICAgZm9yRWFjaChldmVudHMsIGZ1bmN0aW9uIChldmVudFR5cGUpIHtcbiAgICAgIHJvb3RFbGVtZW50LnJlbW92ZUV2ZW50TGlzdGVuZXIoZXZlbnRUeXBlLCBoYW5kbGVFdmVudCwgdHJ1ZSlcbiAgICB9KVxuICB9XG5cbiAgLyoqXG4gICAqIEhhbmRsZSBhbiBldmVudCB0aGF0IGhhcyBvY2N1cmVkIHdpdGhpbiB0aGUgY29udGFpbmVyXG4gICAqXG4gICAqIEBwYXJhbSB7RXZlbnR9IGV2ZW50XG4gICAqL1xuXG4gIGZ1bmN0aW9uIGhhbmRsZUV2ZW50IChldmVudCkge1xuICAgIHZhciB0YXJnZXQgPSBldmVudC50YXJnZXRcbiAgICB2YXIgZXZlbnRUeXBlID0gZXZlbnQudHlwZVxuXG4gICAgLy8gV2FsayB1cCB0aGUgRE9NIHRyZWUgYW5kIHNlZSBpZiB0aGVyZSBpcyBhIGhhbmRsZXJcbiAgICAvLyBmb3IgdGhpcyBldmVudCB0eXBlIGhpZ2hlciB1cC5cbiAgICB3aGlsZSAodGFyZ2V0KSB7XG4gICAgICB2YXIgZm4gPSBrZXlwYXRoLmdldChoYW5kbGVycywgW3RhcmdldC5fX2VudGl0eV9fLCB0YXJnZXQuX19wYXRoX18sIGV2ZW50VHlwZV0pXG4gICAgICBpZiAoZm4pIHtcbiAgICAgICAgZXZlbnQuZGVsZWdhdGVUYXJnZXQgPSB0YXJnZXRcbiAgICAgICAgaWYgKGZuKGV2ZW50KSA9PT0gZmFsc2UpIGJyZWFrXG4gICAgICB9XG4gICAgICB0YXJnZXQgPSB0YXJnZXQucGFyZW50Tm9kZVxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBCaW5kIGV2ZW50cyBmb3IgYW4gZWxlbWVudCwgYW5kIGFsbCBpdCdzIHJlbmRlcmVkIGNoaWxkIGVsZW1lbnRzLlxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gcGF0aFxuICAgKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAgICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAgICovXG5cbiAgZnVuY3Rpb24gYWRkRXZlbnQgKGVudGl0eUlkLCBwYXRoLCBldmVudFR5cGUsIGZuKSB7XG4gICAga2V5cGF0aC5zZXQoaGFuZGxlcnMsIFtlbnRpdHlJZCwgcGF0aCwgZXZlbnRUeXBlXSwgZnVuY3Rpb24gKGUpIHtcbiAgICAgIHZhciBlbnRpdHkgPSBlbnRpdGllc1tlbnRpdHlJZF1cbiAgICAgIGlmIChlbnRpdHkpIHtcbiAgICAgICAgcmV0dXJuIGZuLmNhbGwobnVsbCwgZSwgZW50aXR5LmNvbnRleHQsIHNldFN0YXRlKGVudGl0eSkpXG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gZm4uY2FsbChudWxsLCBlKVxuICAgICAgfVxuICAgIH0pXG4gIH1cblxuICAvKipcbiAgICogVW5iaW5kIGV2ZW50cyBmb3IgYSBlbnRpdHlJZFxuICAgKlxuICAgKiBAcGFyYW0ge1N0cmluZ30gZW50aXR5SWRcbiAgICovXG5cbiAgZnVuY3Rpb24gcmVtb3ZlRXZlbnQgKGVudGl0eUlkLCBwYXRoLCBldmVudFR5cGUpIHtcbiAgICB2YXIgYXJncyA9IFtlbnRpdHlJZF1cbiAgICBpZiAocGF0aCkgYXJncy5wdXNoKHBhdGgpXG4gICAgaWYgKGV2ZW50VHlwZSkgYXJncy5wdXNoKGV2ZW50VHlwZSlcbiAgICBrZXlwYXRoLmRlbChoYW5kbGVycywgYXJncylcbiAgfVxuXG4gIC8qKlxuICAgKiBVbmJpbmQgYWxsIGV2ZW50cyBmcm9tIGFuIGVudGl0eVxuICAgKlxuICAgKiBAcGFyYW0ge0VudGl0eX0gZW50aXR5XG4gICAqL1xuXG4gIGZ1bmN0aW9uIHJlbW92ZUFsbEV2ZW50cyAoZW50aXR5SWQpIHtcbiAgICBrZXlwYXRoLmRlbChoYW5kbGVycywgW2VudGl0eUlkXSlcbiAgfVxuXG4gIC8qKlxuICAgKiBVc2VkIGZvciBkZWJ1Z2dpbmcgdG8gaW5zcGVjdCB0aGUgY3VycmVudCBzdGF0ZSB3aXRob3V0XG4gICAqIHVzIG5lZWRpbmcgdG8gZXhwbGljaXRseSBtYW5hZ2Ugc3RvcmluZy91cGRhdGluZyByZWZlcmVuY2VzLlxuICAgKlxuICAgKiBAcmV0dXJuIHtPYmplY3R9XG4gICAqL1xuXG4gIGZ1bmN0aW9uIGluc3BlY3QgKCkge1xuICAgIHJldHVybiB7XG4gICAgICBlbnRpdGllczogZW50aXRpZXMsXG4gICAgICBoYW5kbGVyczogaGFuZGxlcnMsXG4gICAgICBjb25uZWN0aW9uczogY29ubmVjdGlvbnMsXG4gICAgICBjdXJyZW50RWxlbWVudDogY3VycmVudEVsZW1lbnQsXG4gICAgICBvcHRpb25zOiBvcHRpb25zLFxuICAgICAgYXBwOiBhcHAsXG4gICAgICBjb250YWluZXI6IGNvbnRhaW5lcixcbiAgICAgIGNoaWxkcmVuOiBjaGlsZHJlblxuICAgIH1cbiAgfVxuXG4gIC8qKlxuICAgKiBSZXR1cm4gYW4gb2JqZWN0IHRoYXQgbGV0cyB1cyBjb21wbGV0ZWx5IHJlbW92ZSB0aGUgYXV0b21hdGljXG4gICAqIERPTSByZW5kZXJpbmcgYW5kIGV4cG9ydCBkZWJ1Z2dpbmcgdG9vbHMuXG4gICAqL1xuXG4gIHJldHVybiB7XG4gICAgcmVtb3ZlOiB0ZWFyZG93bixcbiAgICBpbnNwZWN0OiBpbnNwZWN0XG4gIH1cbn1cblxuLyoqXG4gKiBBIHJlbmRlcmVkIGNvbXBvbmVudCBpbnN0YW5jZS5cbiAqXG4gKiBUaGlzIG1hbmFnZXMgdGhlIGxpZmVjeWNsZSwgcHJvcHMgYW5kIHN0YXRlIG9mIHRoZSBjb21wb25lbnQuXG4gKiBJdCdzIGJhc2ljYWxseSBqdXN0IGEgZGF0YSBvYmplY3QgZm9yIG1vcmUgc3RyYWlnaHRmb3dhcmQgbG9va3VwLlxuICpcbiAqIEBwYXJhbSB7Q29tcG9uZW50fSBjb21wb25lbnRcbiAqIEBwYXJhbSB7T2JqZWN0fSBwcm9wc1xuICovXG5cbmZ1bmN0aW9uIEVudGl0eSAoY29tcG9uZW50LCBwcm9wcywgb3duZXJJZCkge1xuICB0aGlzLmlkID0gdWlkKClcbiAgdGhpcy5vd25lcklkID0gb3duZXJJZFxuICB0aGlzLmNvbXBvbmVudCA9IGNvbXBvbmVudFxuICB0aGlzLnByb3BUeXBlcyA9IGNvbXBvbmVudC5wcm9wVHlwZXMgfHwge31cbiAgdGhpcy5jb250ZXh0ID0ge31cbiAgdGhpcy5jb250ZXh0LmlkID0gdGhpcy5pZFxuICB0aGlzLmNvbnRleHQucHJvcHMgPSBkZWZhdWx0cyhwcm9wcyB8fCB7fSwgY29tcG9uZW50LmRlZmF1bHRQcm9wcyB8fCB7fSlcbiAgdGhpcy5jb250ZXh0LnN0YXRlID0gdGhpcy5jb21wb25lbnQuaW5pdGlhbFN0YXRlID8gdGhpcy5jb21wb25lbnQuaW5pdGlhbFN0YXRlKHRoaXMuY29udGV4dC5wcm9wcykgOiB7fVxuICB0aGlzLnBlbmRpbmdQcm9wcyA9IGFzc2lnbih7fSwgdGhpcy5jb250ZXh0LnByb3BzKVxuICB0aGlzLnBlbmRpbmdTdGF0ZSA9IGFzc2lnbih7fSwgdGhpcy5jb250ZXh0LnN0YXRlKVxuICB0aGlzLmRpcnR5ID0gZmFsc2VcbiAgdGhpcy52aXJ0dWFsRWxlbWVudCA9IG51bGxcbiAgdGhpcy5uYXRpdmVFbGVtZW50ID0gbnVsbFxuICB0aGlzLmRpc3BsYXlOYW1lID0gY29tcG9uZW50Lm5hbWUgfHwgJ0NvbXBvbmVudCdcbn1cblxuLyoqXG4gKiBSZXRyaWV2ZSB0aGUgbmVhcmVzdCAnYm9keScgYW5jZXN0b3Igb2YgdGhlIGdpdmVuIGVsZW1lbnQgb3IgZWxzZSB0aGUgcm9vdFxuICogZWxlbWVudCBvZiB0aGUgZG9jdW1lbnQgaW4gd2hpY2ggc3RhbmRzIHRoZSBnaXZlbiBlbGVtZW50LlxuICpcbiAqIFRoaXMgaXMgbmVjZXNzYXJ5IGlmIHlvdSB3YW50IHRvIGF0dGFjaCB0aGUgZXZlbnRzIGhhbmRsZXIgdG8gdGhlIGNvcnJlY3RcbiAqIGVsZW1lbnQgYW5kIGJlIGFibGUgdG8gZGlzcGF0Y2ggZXZlbnRzIGluIGRvY3VtZW50IGZyYWdtZW50cyBzdWNoIGFzXG4gKiBTaGFkb3cgRE9NLlxuICpcbiAqIEBwYXJhbSAge0hUTUxFbGVtZW50fSBlbCBUaGUgZWxlbWVudCBvbiB3aGljaCB3ZSB3aWxsIHJlbmRlciBhbiBhcHAuXG4gKiBAcmV0dXJuIHtIVE1MRWxlbWVudH0gICAgVGhlIHJvb3QgZWxlbWVudCBvbiB3aGljaCB3ZSB3aWxsIGF0dGFjaCB0aGUgZXZlbnRzXG4gKiAgICAgICAgICAgICAgICAgICAgICAgICAgaGFuZGxlci5cbiAqL1xuXG5mdW5jdGlvbiBnZXRSb290RWxlbWVudCAoZWwpIHtcbiAgd2hpbGUgKGVsLnBhcmVudEVsZW1lbnQpIHtcbiAgICBpZiAoZWwudGFnTmFtZSA9PT0gJ0JPRFknIHx8ICFlbC5wYXJlbnRFbGVtZW50KSB7XG4gICAgICByZXR1cm4gZWxcbiAgICB9XG4gICAgZWwgPSBlbC5wYXJlbnRFbGVtZW50XG4gIH1cbiAgcmV0dXJuIGVsXG59XG5cbi8qKlxuICogU2V0IHRoZSB2YWx1ZSBwcm9wZXJ0eSBvZiBhbiBlbGVtZW50IGFuZCBrZWVwIHRoZSB0ZXh0IHNlbGVjdGlvblxuICogZm9yIGlucHV0IGZpZWxkcy5cbiAqXG4gKiBAcGFyYW0ge0hUTUxFbGVtZW50fSBlbFxuICogQHBhcmFtIHtTdHJpbmd9IHZhbHVlXG4gKi9cblxuZnVuY3Rpb24gc2V0RWxlbWVudFZhbHVlIChlbCwgdmFsdWUpIHtcbiAgaWYgKGVsID09PSBkb2N1bWVudC5hY3RpdmVFbGVtZW50ICYmIGNhblNlbGVjdFRleHQoZWwpKSB7XG4gICAgdmFyIHN0YXJ0ID0gZWwuc2VsZWN0aW9uU3RhcnRcbiAgICB2YXIgZW5kID0gZWwuc2VsZWN0aW9uRW5kXG4gICAgZWwudmFsdWUgPSB2YWx1ZVxuICAgIGVsLnNldFNlbGVjdGlvblJhbmdlKHN0YXJ0LCBlbmQpXG4gIH0gZWxzZSB7XG4gICAgZWwudmFsdWUgPSB2YWx1ZVxuICB9XG59XG5cbi8qKlxuICogRm9yIHNvbWUgcmVhc29uIG9ubHkgY2VydGFpbiB0eXBlcyBvZiBpbnB1dHMgY2FuIHNldCB0aGUgc2VsZWN0aW9uIHJhbmdlLlxuICpcbiAqIEBwYXJhbSB7SFRNTEVsZW1lbnR9IGVsXG4gKlxuICogQHJldHVybiB7Qm9vbGVhbn1cbiAqL1xuXG5mdW5jdGlvbiBjYW5TZWxlY3RUZXh0IChlbCkge1xuICByZXR1cm4gZWwudGFnTmFtZSA9PT0gJ0lOUFVUJyAmJiBbJ3RleHQnLCdzZWFyY2gnLCdwYXNzd29yZCcsJ3RlbCcsJ3VybCddLmluZGV4T2YoZWwudHlwZSkgPiAtMVxufVxuIiwidmFyIGRlZmF1bHRzID0gcmVxdWlyZSgnb2JqZWN0LWRlZmF1bHRzJylcbnZhciBub2RlVHlwZSA9IHJlcXVpcmUoJy4vbm9kZS10eXBlJylcbnZhciB0eXBlID0gcmVxdWlyZSgnY29tcG9uZW50LXR5cGUnKVxuXG4vKipcbiAqIEV4cG9zZSBgc3RyaW5naWZ5YC5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChhcHApIHtcbiAgaWYgKCFhcHAuZWxlbWVudCkge1xuICAgIHRocm93IG5ldyBFcnJvcignTm8gZWxlbWVudCBtb3VudGVkJylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW5kZXIgdG8gc3RyaW5nLlxuICAgKlxuICAgKiBAcGFyYW0ge0NvbXBvbmVudH0gY29tcG9uZW50XG4gICAqIEBwYXJhbSB7T2JqZWN0fSBbcHJvcHNdXG4gICAqIEByZXR1cm4ge1N0cmluZ31cbiAgICovXG5cbiAgZnVuY3Rpb24gc3RyaW5naWZ5IChjb21wb25lbnQsIG9wdFByb3BzLCBjaGlsZHJlbikge1xuICAgIHZhciBwcm9wVHlwZXMgPSBjb21wb25lbnQucHJvcFR5cGVzIHx8IHt9XG4gICAgdmFyIHByb3BzID0gZGVmYXVsdHMob3B0UHJvcHMgfHwge30sIGNvbXBvbmVudC5kZWZhdWx0UHJvcHMgfHwge30pXG4gICAgdmFyIHN0YXRlID0gY29tcG9uZW50LmluaXRpYWxTdGF0ZSA/IGNvbXBvbmVudC5pbml0aWFsU3RhdGUocHJvcHMpIDoge31cbiAgICBwcm9wcy5jaGlsZHJlbiA9IGNoaWxkcmVuO1xuXG4gICAgZm9yICh2YXIgbmFtZSBpbiBwcm9wVHlwZXMpIHtcbiAgICAgIHZhciBvcHRpb25zID0gcHJvcFR5cGVzW25hbWVdXG4gICAgICBpZiAob3B0aW9ucy5zb3VyY2UpIHtcbiAgICAgICAgcHJvcHNbbmFtZV0gPSBhcHAuc291cmNlc1tvcHRpb25zLnNvdXJjZV1cbiAgICAgIH1cbiAgICB9XG5cbiAgICBpZiAoY29tcG9uZW50LmJlZm9yZU1vdW50KSBjb21wb25lbnQuYmVmb3JlTW91bnQoeyBwcm9wczogcHJvcHMsIHN0YXRlOiBzdGF0ZSB9KVxuICAgIGlmIChjb21wb25lbnQuYmVmb3JlUmVuZGVyKSBjb21wb25lbnQuYmVmb3JlUmVuZGVyKHsgcHJvcHM6IHByb3BzLCBzdGF0ZTogc3RhdGUgfSlcbiAgICB2YXIgbm9kZSA9IGNvbXBvbmVudC5yZW5kZXIoeyBwcm9wczogcHJvcHMsIHN0YXRlOiBzdGF0ZSB9KVxuICAgIHJldHVybiBzdHJpbmdpZnlOb2RlKG5vZGUsICcwJylcbiAgfVxuXG4gIC8qKlxuICAgKiBSZW5kZXIgYSBub2RlIHRvIGEgc3RyaW5nXG4gICAqXG4gICAqIEBwYXJhbSB7Tm9kZX0gbm9kZVxuICAgKiBAcGFyYW0ge1RyZWV9IHRyZWVcbiAgICpcbiAgICogQHJldHVybiB7U3RyaW5nfVxuICAgKi9cblxuICBmdW5jdGlvbiBzdHJpbmdpZnlOb2RlIChub2RlLCBwYXRoKSB7XG4gICAgc3dpdGNoIChub2RlVHlwZShub2RlKSkge1xuICAgICAgY2FzZSAnZW1wdHknOiByZXR1cm4gJzxub3NjcmlwdCAvPidcbiAgICAgIGNhc2UgJ3RleHQnOiByZXR1cm4gbm9kZVxuICAgICAgY2FzZSAnZWxlbWVudCc6XG4gICAgICAgIHZhciBjaGlsZHJlbiA9IG5vZGUuY2hpbGRyZW5cbiAgICAgICAgdmFyIGF0dHJpYnV0ZXMgPSBub2RlLmF0dHJpYnV0ZXNcbiAgICAgICAgdmFyIHRhZ05hbWUgPSBub2RlLnR5cGVcbiAgICAgICAgdmFyIGlubmVySFRNTCA9IGF0dHJpYnV0ZXMuaW5uZXJIVE1MXG4gICAgICAgIHZhciBzdHIgPSAnPCcgKyB0YWdOYW1lICsgYXR0cnMoYXR0cmlidXRlcykgKyAnPidcblxuICAgICAgICBpZiAoaW5uZXJIVE1MKSB7XG4gICAgICAgICAgc3RyICs9IGlubmVySFRNTFxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGZvciAodmFyIGkgPSAwLCBuID0gY2hpbGRyZW4ubGVuZ3RoOyBpIDwgbjsgaSsrKSB7XG4gICAgICAgICAgICBzdHIgKz0gc3RyaW5naWZ5Tm9kZShjaGlsZHJlbltpXSwgcGF0aCArICcuJyArIGkpXG4gICAgICAgICAgfVxuICAgICAgICB9XG5cbiAgICAgICAgc3RyICs9ICc8LycgKyB0YWdOYW1lICsgJz4nXG4gICAgICAgIHJldHVybiBzdHJcbiAgICAgIGNhc2UgJ2NvbXBvbmVudCc6IHJldHVybiBzdHJpbmdpZnkobm9kZS50eXBlLCBub2RlLmF0dHJpYnV0ZXMsIG5vZGUuY2hpbGRyZW4pXG4gICAgfVxuXG4gICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHR5cGUnKVxuICB9XG5cbiAgcmV0dXJuIHN0cmluZ2lmeU5vZGUoYXBwLmVsZW1lbnQsICcwJylcbn1cblxuLyoqXG4gKiBIVE1MIGF0dHJpYnV0ZXMgdG8gc3RyaW5nLlxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBhdHRyaWJ1dGVzXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBhdHRycyAoYXR0cmlidXRlcykge1xuICB2YXIgc3RyID0gJydcbiAgZm9yICh2YXIga2V5IGluIGF0dHJpYnV0ZXMpIHtcbiAgICB2YXIgdmFsdWUgPSBhdHRyaWJ1dGVzW2tleV1cbiAgICBpZiAoa2V5ID09PSAnaW5uZXJIVE1MJykgY29udGludWVcbiAgICBpZiAoaXNWYWxpZEF0dHJpYnV0ZVZhbHVlKHZhbHVlKSkgc3RyICs9IGF0dHIoa2V5LCBhdHRyaWJ1dGVzW2tleV0pXG4gIH1cbiAgcmV0dXJuIHN0clxufVxuXG4vKipcbiAqIEhUTUwgYXR0cmlidXRlIHRvIHN0cmluZy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30ga2V5XG4gKiBAcGFyYW0ge1N0cmluZ30gdmFsXG4gKiBAcmV0dXJuIHtTdHJpbmd9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBhdHRyIChrZXksIHZhbCkge1xuICByZXR1cm4gJyAnICsga2V5ICsgJz1cIicgKyB2YWwgKyAnXCInXG59XG5cbi8qKlxuICogSXMgYSB2YWx1ZSBhYmxlIHRvIGJlIHNldCBhIGFuIGF0dHJpYnV0ZSB2YWx1ZT9cbiAqXG4gKiBAcGFyYW0ge0FueX0gdmFsdWVcbiAqXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICovXG5cbmZ1bmN0aW9uIGlzVmFsaWRBdHRyaWJ1dGVWYWx1ZSAodmFsdWUpIHtcbiAgdmFyIHZhbHVlVHlwZSA9IHR5cGUodmFsdWUpXG4gIHN3aXRjaCAodmFsdWVUeXBlKSB7XG4gIGNhc2UgJ3N0cmluZyc6XG4gIGNhc2UgJ251bWJlcic6XG4gICAgcmV0dXJuIHRydWU7XG5cbiAgY2FzZSAnYm9vbGVhbic6XG4gICAgcmV0dXJuIHZhbHVlO1xuXG4gIGRlZmF1bHQ6XG4gICAgcmV0dXJuIGZhbHNlO1xuICB9XG59XG4iLCJtb2R1bGUuZXhwb3J0cyA9IHtcbiAgaXNFbGVtZW50OiByZXF1aXJlKCdpcy1zdmctZWxlbWVudCcpLmlzRWxlbWVudCxcbiAgaXNBdHRyaWJ1dGU6IHJlcXVpcmUoJ2lzLXN2Zy1hdHRyaWJ1dGUnKSxcbiAgbmFtZXNwYWNlOiAnaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmcnXG59XG4iLCJcbi8qKlxuICogRXhwb3NlIGBFbWl0dGVyYC5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IEVtaXR0ZXI7XG5cbi8qKlxuICogSW5pdGlhbGl6ZSBhIG5ldyBgRW1pdHRlcmAuXG4gKlxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBFbWl0dGVyKG9iaikge1xuICBpZiAob2JqKSByZXR1cm4gbWl4aW4ob2JqKTtcbn07XG5cbi8qKlxuICogTWl4aW4gdGhlIGVtaXR0ZXIgcHJvcGVydGllcy5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqXG4gKiBAcmV0dXJuIHtPYmplY3R9XG4gKiBAYXBpIHByaXZhdGVcbiAqL1xuXG5mdW5jdGlvbiBtaXhpbihvYmopIHtcbiAgZm9yICh2YXIga2V5IGluIEVtaXR0ZXIucHJvdG90eXBlKSB7XG4gICAgb2JqW2tleV0gPSBFbWl0dGVyLnByb3RvdHlwZVtrZXldO1xuICB9XG4gIHJldHVybiBvYmo7XG59XG5cbi8qKlxuICogTGlzdGVuIG9uIHRoZSBnaXZlbiBgZXZlbnRgIHdpdGggYGZuYC5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAqIEBwYXJhbSB7RnVuY3Rpb259IGZuXG4gKiBAcmV0dXJuIHtFbWl0dGVyfVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5vbiA9XG5FbWl0dGVyLnByb3RvdHlwZS5hZGRFdmVudExpc3RlbmVyID0gZnVuY3Rpb24oZXZlbnQsIGZuKXtcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xuICAodGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XSA9IHRoaXMuX2NhbGxiYWNrc1snJCcgKyBldmVudF0gfHwgW10pXG4gICAgLnB1c2goZm4pO1xuICByZXR1cm4gdGhpcztcbn07XG5cbi8qKlxuICogQWRkcyBhbiBgZXZlbnRgIGxpc3RlbmVyIHRoYXQgd2lsbCBiZSBpbnZva2VkIGEgc2luZ2xlXG4gKiB0aW1lIHRoZW4gYXV0b21hdGljYWxseSByZW1vdmVkLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHBhcmFtIHtGdW5jdGlvbn0gZm5cbiAqIEByZXR1cm4ge0VtaXR0ZXJ9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLm9uY2UgPSBmdW5jdGlvbihldmVudCwgZm4pe1xuICBmdW5jdGlvbiBvbigpIHtcbiAgICB0aGlzLm9mZihldmVudCwgb24pO1xuICAgIGZuLmFwcGx5KHRoaXMsIGFyZ3VtZW50cyk7XG4gIH1cblxuICBvbi5mbiA9IGZuO1xuICB0aGlzLm9uKGV2ZW50LCBvbik7XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBSZW1vdmUgdGhlIGdpdmVuIGNhbGxiYWNrIGZvciBgZXZlbnRgIG9yIGFsbFxuICogcmVnaXN0ZXJlZCBjYWxsYmFja3MuXG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IGV2ZW50XG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmblxuICogQHJldHVybiB7RW1pdHRlcn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUub2ZmID1cbkVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUxpc3RlbmVyID1cbkVtaXR0ZXIucHJvdG90eXBlLnJlbW92ZUFsbExpc3RlbmVycyA9XG5FbWl0dGVyLnByb3RvdHlwZS5yZW1vdmVFdmVudExpc3RlbmVyID0gZnVuY3Rpb24oZXZlbnQsIGZuKXtcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xuXG4gIC8vIGFsbFxuICBpZiAoMCA9PSBhcmd1bWVudHMubGVuZ3RoKSB7XG4gICAgdGhpcy5fY2FsbGJhY2tzID0ge307XG4gICAgcmV0dXJuIHRoaXM7XG4gIH1cblxuICAvLyBzcGVjaWZpYyBldmVudFxuICB2YXIgY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XTtcbiAgaWYgKCFjYWxsYmFja3MpIHJldHVybiB0aGlzO1xuXG4gIC8vIHJlbW92ZSBhbGwgaGFuZGxlcnNcbiAgaWYgKDEgPT0gYXJndW1lbnRzLmxlbmd0aCkge1xuICAgIGRlbGV0ZSB0aGlzLl9jYWxsYmFja3NbJyQnICsgZXZlbnRdO1xuICAgIHJldHVybiB0aGlzO1xuICB9XG5cbiAgLy8gcmVtb3ZlIHNwZWNpZmljIGhhbmRsZXJcbiAgdmFyIGNiO1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGNhbGxiYWNrcy5sZW5ndGg7IGkrKykge1xuICAgIGNiID0gY2FsbGJhY2tzW2ldO1xuICAgIGlmIChjYiA9PT0gZm4gfHwgY2IuZm4gPT09IGZuKSB7XG4gICAgICBjYWxsYmFja3Muc3BsaWNlKGksIDEpO1xuICAgICAgYnJlYWs7XG4gICAgfVxuICB9XG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBFbWl0IGBldmVudGAgd2l0aCB0aGUgZ2l2ZW4gYXJncy5cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gZXZlbnRcbiAqIEBwYXJhbSB7TWl4ZWR9IC4uLlxuICogQHJldHVybiB7RW1pdHRlcn1cbiAqL1xuXG5FbWl0dGVyLnByb3RvdHlwZS5lbWl0ID0gZnVuY3Rpb24oZXZlbnQpe1xuICB0aGlzLl9jYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3MgfHwge307XG4gIHZhciBhcmdzID0gW10uc2xpY2UuY2FsbChhcmd1bWVudHMsIDEpXG4gICAgLCBjYWxsYmFja3MgPSB0aGlzLl9jYWxsYmFja3NbJyQnICsgZXZlbnRdO1xuXG4gIGlmIChjYWxsYmFja3MpIHtcbiAgICBjYWxsYmFja3MgPSBjYWxsYmFja3Muc2xpY2UoMCk7XG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IGNhbGxiYWNrcy5sZW5ndGg7IGkgPCBsZW47ICsraSkge1xuICAgICAgY2FsbGJhY2tzW2ldLmFwcGx5KHRoaXMsIGFyZ3MpO1xuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzO1xufTtcblxuLyoqXG4gKiBSZXR1cm4gYXJyYXkgb2YgY2FsbGJhY2tzIGZvciBgZXZlbnRgLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHJldHVybiB7QXJyYXl9XG4gKiBAYXBpIHB1YmxpY1xuICovXG5cbkVtaXR0ZXIucHJvdG90eXBlLmxpc3RlbmVycyA9IGZ1bmN0aW9uKGV2ZW50KXtcbiAgdGhpcy5fY2FsbGJhY2tzID0gdGhpcy5fY2FsbGJhY2tzIHx8IHt9O1xuICByZXR1cm4gdGhpcy5fY2FsbGJhY2tzWyckJyArIGV2ZW50XSB8fCBbXTtcbn07XG5cbi8qKlxuICogQ2hlY2sgaWYgdGhpcyBlbWl0dGVyIGhhcyBgZXZlbnRgIGhhbmRsZXJzLlxuICpcbiAqIEBwYXJhbSB7U3RyaW5nfSBldmVudFxuICogQHJldHVybiB7Qm9vbGVhbn1cbiAqIEBhcGkgcHVibGljXG4gKi9cblxuRW1pdHRlci5wcm90b3R5cGUuaGFzTGlzdGVuZXJzID0gZnVuY3Rpb24oZXZlbnQpe1xuICByZXR1cm4gISEgdGhpcy5saXN0ZW5lcnMoZXZlbnQpLmxlbmd0aDtcbn07XG4iLCIvKipcbiAqIEV4cG9zZSBgcmVxdWVzdEFuaW1hdGlvbkZyYW1lKClgLlxuICovXG5cbmV4cG9ydHMgPSBtb2R1bGUuZXhwb3J0cyA9IHdpbmRvdy5yZXF1ZXN0QW5pbWF0aW9uRnJhbWVcbiAgfHwgd2luZG93LndlYmtpdFJlcXVlc3RBbmltYXRpb25GcmFtZVxuICB8fCB3aW5kb3cubW96UmVxdWVzdEFuaW1hdGlvbkZyYW1lXG4gIHx8IGZhbGxiYWNrO1xuXG4vKipcbiAqIEZhbGxiYWNrIGltcGxlbWVudGF0aW9uLlxuICovXG5cbnZhciBwcmV2ID0gbmV3IERhdGUoKS5nZXRUaW1lKCk7XG5mdW5jdGlvbiBmYWxsYmFjayhmbikge1xuICB2YXIgY3VyciA9IG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xuICB2YXIgbXMgPSBNYXRoLm1heCgwLCAxNiAtIChjdXJyIC0gcHJldikpO1xuICB2YXIgcmVxID0gc2V0VGltZW91dChmbiwgbXMpO1xuICBwcmV2ID0gY3VycjtcbiAgcmV0dXJuIHJlcTtcbn1cblxuLyoqXG4gKiBDYW5jZWwuXG4gKi9cblxudmFyIGNhbmNlbCA9IHdpbmRvdy5jYW5jZWxBbmltYXRpb25GcmFtZVxuICB8fCB3aW5kb3cud2Via2l0Q2FuY2VsQW5pbWF0aW9uRnJhbWVcbiAgfHwgd2luZG93Lm1vekNhbmNlbEFuaW1hdGlvbkZyYW1lXG4gIHx8IHdpbmRvdy5jbGVhclRpbWVvdXQ7XG5cbmV4cG9ydHMuY2FuY2VsID0gZnVuY3Rpb24oaWQpe1xuICBjYW5jZWwuY2FsbCh3aW5kb3csIGlkKTtcbn07XG4iLCIvKipcbiAqIHRvU3RyaW5nIHJlZi5cbiAqL1xuXG52YXIgdG9TdHJpbmcgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuXG4vKipcbiAqIFJldHVybiB0aGUgdHlwZSBvZiBgdmFsYC5cbiAqXG4gKiBAcGFyYW0ge01peGVkfSB2YWxcbiAqIEByZXR1cm4ge1N0cmluZ31cbiAqIEBhcGkgcHVibGljXG4gKi9cblxubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbih2YWwpe1xuICBzd2l0Y2ggKHRvU3RyaW5nLmNhbGwodmFsKSkge1xuICAgIGNhc2UgJ1tvYmplY3QgRGF0ZV0nOiByZXR1cm4gJ2RhdGUnO1xuICAgIGNhc2UgJ1tvYmplY3QgUmVnRXhwXSc6IHJldHVybiAncmVnZXhwJztcbiAgICBjYXNlICdbb2JqZWN0IEFyZ3VtZW50c10nOiByZXR1cm4gJ2FyZ3VtZW50cyc7XG4gICAgY2FzZSAnW29iamVjdCBBcnJheV0nOiByZXR1cm4gJ2FycmF5JztcbiAgICBjYXNlICdbb2JqZWN0IEVycm9yXSc6IHJldHVybiAnZXJyb3InO1xuICB9XG5cbiAgaWYgKHZhbCA9PT0gbnVsbCkgcmV0dXJuICdudWxsJztcbiAgaWYgKHZhbCA9PT0gdW5kZWZpbmVkKSByZXR1cm4gJ3VuZGVmaW5lZCc7XG4gIGlmICh2YWwgIT09IHZhbCkgcmV0dXJuICduYW4nO1xuICBpZiAodmFsICYmIHZhbC5ub2RlVHlwZSA9PT0gMSkgcmV0dXJuICdlbGVtZW50JztcblxuICBpZiAodHlwZW9mIEJ1ZmZlciAhPSAndW5kZWZpbmVkJyAmJiBCdWZmZXIuaXNCdWZmZXIodmFsKSkgcmV0dXJuICdidWZmZXInO1xuXG4gIHZhbCA9IHZhbC52YWx1ZU9mXG4gICAgPyB2YWwudmFsdWVPZigpXG4gICAgOiBPYmplY3QucHJvdG90eXBlLnZhbHVlT2YuYXBwbHkodmFsKVxuXG4gIHJldHVybiB0eXBlb2YgdmFsO1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGJpbmRJbnRlcm5hbDMgPSByZXF1aXJlKCcuLi9mdW5jdGlvbi9iaW5kSW50ZXJuYWwzJyk7XG5cbi8qKlxuICogIyBGb3IgRWFjaFxuICpcbiAqIEEgZmFzdCBgLmZvckVhY2goKWAgaW1wbGVtZW50YXRpb24uXG4gKlxuICogQHBhcmFtICB7QXJyYXl9ICAgIHN1YmplY3QgICAgIFRoZSBhcnJheSAob3IgYXJyYXktbGlrZSkgdG8gaXRlcmF0ZSBvdmVyLlxuICogQHBhcmFtICB7RnVuY3Rpb259IGZuICAgICAgICAgIFRoZSB2aXNpdG9yIGZ1bmN0aW9uLlxuICogQHBhcmFtICB7T2JqZWN0fSAgIHRoaXNDb250ZXh0IFRoZSBjb250ZXh0IGZvciB0aGUgdmlzaXRvci5cbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBmYXN0Rm9yRWFjaCAoc3ViamVjdCwgZm4sIHRoaXNDb250ZXh0KSB7XG4gIHZhciBsZW5ndGggPSBzdWJqZWN0Lmxlbmd0aCxcbiAgICAgIGl0ZXJhdG9yID0gdGhpc0NvbnRleHQgIT09IHVuZGVmaW5lZCA/IGJpbmRJbnRlcm5hbDMoZm4sIHRoaXNDb250ZXh0KSA6IGZuLFxuICAgICAgaTtcbiAgZm9yIChpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgaXRlcmF0b3Ioc3ViamVjdFtpXSwgaSwgc3ViamVjdCk7XG4gIH1cbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBiaW5kSW50ZXJuYWw0ID0gcmVxdWlyZSgnLi4vZnVuY3Rpb24vYmluZEludGVybmFsNCcpO1xuXG4vKipcbiAqICMgUmVkdWNlXG4gKlxuICogQSBmYXN0IGAucmVkdWNlKClgIGltcGxlbWVudGF0aW9uLlxuICpcbiAqIEBwYXJhbSAge0FycmF5fSAgICBzdWJqZWN0ICAgICAgVGhlIGFycmF5IChvciBhcnJheS1saWtlKSB0byByZWR1Y2UuXG4gKiBAcGFyYW0gIHtGdW5jdGlvbn0gZm4gICAgICAgICAgIFRoZSByZWR1Y2VyIGZ1bmN0aW9uLlxuICogQHBhcmFtICB7bWl4ZWR9ICAgIGluaXRpYWxWYWx1ZSBUaGUgaW5pdGlhbCB2YWx1ZSBmb3IgdGhlIHJlZHVjZXIsIGRlZmF1bHRzIHRvIHN1YmplY3RbMF0uXG4gKiBAcGFyYW0gIHtPYmplY3R9ICAgdGhpc0NvbnRleHQgIFRoZSBjb250ZXh0IGZvciB0aGUgcmVkdWNlci5cbiAqIEByZXR1cm4ge21peGVkfSAgICAgICAgICAgICAgICAgVGhlIGZpbmFsIHJlc3VsdC5cbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBmYXN0UmVkdWNlIChzdWJqZWN0LCBmbiwgaW5pdGlhbFZhbHVlLCB0aGlzQ29udGV4dCkge1xuICB2YXIgbGVuZ3RoID0gc3ViamVjdC5sZW5ndGgsXG4gICAgICBpdGVyYXRvciA9IHRoaXNDb250ZXh0ICE9PSB1bmRlZmluZWQgPyBiaW5kSW50ZXJuYWw0KGZuLCB0aGlzQ29udGV4dCkgOiBmbixcbiAgICAgIGksIHJlc3VsdDtcblxuICBpZiAoaW5pdGlhbFZhbHVlID09PSB1bmRlZmluZWQpIHtcbiAgICBpID0gMTtcbiAgICByZXN1bHQgPSBzdWJqZWN0WzBdO1xuICB9XG4gIGVsc2Uge1xuICAgIGkgPSAwO1xuICAgIHJlc3VsdCA9IGluaXRpYWxWYWx1ZTtcbiAgfVxuXG4gIGZvciAoOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICByZXN1bHQgPSBpdGVyYXRvcihyZXN1bHQsIHN1YmplY3RbaV0sIGksIHN1YmplY3QpO1xuICB9XG5cbiAgcmV0dXJuIHJlc3VsdDtcbn07XG4iLCIndXNlIHN0cmljdCc7XG5cbnZhciBmb3JFYWNoQXJyYXkgPSByZXF1aXJlKCcuL2FycmF5L2ZvckVhY2gnKSxcbiAgICBmb3JFYWNoT2JqZWN0ID0gcmVxdWlyZSgnLi9vYmplY3QvZm9yRWFjaCcpO1xuXG4vKipcbiAqICMgRm9yRWFjaFxuICpcbiAqIEEgZmFzdCBgLmZvckVhY2goKWAgaW1wbGVtZW50YXRpb24uXG4gKlxuICogQHBhcmFtICB7QXJyYXl8T2JqZWN0fSBzdWJqZWN0ICAgICBUaGUgYXJyYXkgb3Igb2JqZWN0IHRvIGl0ZXJhdGUgb3Zlci5cbiAqIEBwYXJhbSAge0Z1bmN0aW9ufSAgICAgZm4gICAgICAgICAgVGhlIHZpc2l0b3IgZnVuY3Rpb24uXG4gKiBAcGFyYW0gIHtPYmplY3R9ICAgICAgIHRoaXNDb250ZXh0IFRoZSBjb250ZXh0IGZvciB0aGUgdmlzaXRvci5cbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBmYXN0Rm9yRWFjaCAoc3ViamVjdCwgZm4sIHRoaXNDb250ZXh0KSB7XG4gIGlmIChzdWJqZWN0IGluc3RhbmNlb2YgQXJyYXkpIHtcbiAgICByZXR1cm4gZm9yRWFjaEFycmF5KHN1YmplY3QsIGZuLCB0aGlzQ29udGV4dCk7XG4gIH1cbiAgZWxzZSB7XG4gICAgcmV0dXJuIGZvckVhY2hPYmplY3Qoc3ViamVjdCwgZm4sIHRoaXNDb250ZXh0KTtcbiAgfVxufTsiLCIndXNlIHN0cmljdCc7XG5cbi8qKlxuICogSW50ZXJuYWwgaGVscGVyIHRvIGJpbmQgYSBmdW5jdGlvbiBrbm93biB0byBoYXZlIDMgYXJndW1lbnRzXG4gKiB0byBhIGdpdmVuIGNvbnRleHQuXG4gKi9cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gYmluZEludGVybmFsMyAoZnVuYywgdGhpc0NvbnRleHQpIHtcbiAgcmV0dXJuIGZ1bmN0aW9uIChhLCBiLCBjKSB7XG4gICAgcmV0dXJuIGZ1bmMuY2FsbCh0aGlzQ29udGV4dCwgYSwgYiwgYyk7XG4gIH07XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG4vKipcbiAqIEludGVybmFsIGhlbHBlciB0byBiaW5kIGEgZnVuY3Rpb24ga25vd24gdG8gaGF2ZSA0IGFyZ3VtZW50c1xuICogdG8gYSBnaXZlbiBjb250ZXh0LlxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGJpbmRJbnRlcm5hbDQgKGZ1bmMsIHRoaXNDb250ZXh0KSB7XG4gIHJldHVybiBmdW5jdGlvbiAoYSwgYiwgYywgZCkge1xuICAgIHJldHVybiBmdW5jLmNhbGwodGhpc0NvbnRleHQsIGEsIGIsIGMsIGQpO1xuICB9O1xufTtcbiIsIid1c2Ugc3RyaWN0JztcblxuLyoqXG4gKiBBbmFsb2d1ZSBvZiBPYmplY3QuYXNzaWduKCkuXG4gKiBDb3BpZXMgcHJvcGVydGllcyBmcm9tIG9uZSBvciBtb3JlIHNvdXJjZSBvYmplY3RzIHRvXG4gKiBhIHRhcmdldCBvYmplY3QuIEV4aXN0aW5nIGtleXMgb24gdGhlIHRhcmdldCBvYmplY3Qgd2lsbCBiZSBvdmVyd3JpdHRlbi5cbiAqXG4gKiA+IE5vdGU6IFRoaXMgZGlmZmVycyBmcm9tIHNwZWMgaW4gc29tZSBpbXBvcnRhbnQgd2F5czpcbiAqID4gMS4gV2lsbCB0aHJvdyBpZiBwYXNzZWQgbm9uLW9iamVjdHMsIGluY2x1ZGluZyBgdW5kZWZpbmVkYCBvciBgbnVsbGAgdmFsdWVzLlxuICogPiAyLiBEb2VzIG5vdCBzdXBwb3J0IHRoZSBjdXJpb3VzIEV4Y2VwdGlvbiBoYW5kbGluZyBiZWhhdmlvciwgZXhjZXB0aW9ucyBhcmUgdGhyb3duIGltbWVkaWF0ZWx5LlxuICogPiBGb3IgbW9yZSBkZXRhaWxzLCBzZWU6XG4gKiA+IGh0dHBzOi8vZGV2ZWxvcGVyLm1vemlsbGEub3JnL2VuLVVTL2RvY3MvV2ViL0phdmFTY3JpcHQvUmVmZXJlbmNlL0dsb2JhbF9PYmplY3RzL09iamVjdC9hc3NpZ25cbiAqXG4gKlxuICpcbiAqIEBwYXJhbSAge09iamVjdH0gdGFyZ2V0ICAgICAgVGhlIHRhcmdldCBvYmplY3QgdG8gY29weSBwcm9wZXJ0aWVzIHRvLlxuICogQHBhcmFtICB7T2JqZWN0fSBzb3VyY2UsIC4uLiBUaGUgc291cmNlKHMpIHRvIGNvcHkgcHJvcGVydGllcyBmcm9tLlxuICogQHJldHVybiB7T2JqZWN0fSAgICAgICAgICAgICBUaGUgdXBkYXRlZCB0YXJnZXQgb2JqZWN0LlxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGZhc3RBc3NpZ24gKHRhcmdldCkge1xuICB2YXIgdG90YWxBcmdzID0gYXJndW1lbnRzLmxlbmd0aCxcbiAgICAgIHNvdXJjZSwgaSwgdG90YWxLZXlzLCBrZXlzLCBrZXksIGo7XG5cbiAgZm9yIChpID0gMTsgaSA8IHRvdGFsQXJnczsgaSsrKSB7XG4gICAgc291cmNlID0gYXJndW1lbnRzW2ldO1xuICAgIGtleXMgPSBPYmplY3Qua2V5cyhzb3VyY2UpO1xuICAgIHRvdGFsS2V5cyA9IGtleXMubGVuZ3RoO1xuICAgIGZvciAoaiA9IDA7IGogPCB0b3RhbEtleXM7IGorKykge1xuICAgICAga2V5ID0ga2V5c1tqXTtcbiAgICAgIHRhcmdldFtrZXldID0gc291cmNlW2tleV07XG4gICAgfVxuICB9XG4gIHJldHVybiB0YXJnZXQ7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgYmluZEludGVybmFsMyA9IHJlcXVpcmUoJy4uL2Z1bmN0aW9uL2JpbmRJbnRlcm5hbDMnKTtcblxuLyoqXG4gKiAjIEZvciBFYWNoXG4gKlxuICogQSBmYXN0IG9iamVjdCBgLmZvckVhY2goKWAgaW1wbGVtZW50YXRpb24uXG4gKlxuICogQHBhcmFtICB7T2JqZWN0fSAgIHN1YmplY3QgICAgIFRoZSBvYmplY3QgdG8gaXRlcmF0ZSBvdmVyLlxuICogQHBhcmFtICB7RnVuY3Rpb259IGZuICAgICAgICAgIFRoZSB2aXNpdG9yIGZ1bmN0aW9uLlxuICogQHBhcmFtICB7T2JqZWN0fSAgIHRoaXNDb250ZXh0IFRoZSBjb250ZXh0IGZvciB0aGUgdmlzaXRvci5cbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBmYXN0Rm9yRWFjaE9iamVjdCAoc3ViamVjdCwgZm4sIHRoaXNDb250ZXh0KSB7XG4gIHZhciBrZXlzID0gT2JqZWN0LmtleXMoc3ViamVjdCksXG4gICAgICBsZW5ndGggPSBrZXlzLmxlbmd0aCxcbiAgICAgIGl0ZXJhdG9yID0gdGhpc0NvbnRleHQgIT09IHVuZGVmaW5lZCA/IGJpbmRJbnRlcm5hbDMoZm4sIHRoaXNDb250ZXh0KSA6IGZuLFxuICAgICAga2V5LCBpO1xuICBmb3IgKGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBrZXkgPSBrZXlzW2ldO1xuICAgIGl0ZXJhdG9yKHN1YmplY3Rba2V5XSwga2V5LCBzdWJqZWN0KTtcbiAgfVxufTtcbiIsIid1c2Ugc3RyaWN0JztcblxudmFyIGJpbmRJbnRlcm5hbDQgPSByZXF1aXJlKCcuLi9mdW5jdGlvbi9iaW5kSW50ZXJuYWw0Jyk7XG5cbi8qKlxuICogIyBSZWR1Y2VcbiAqXG4gKiBBIGZhc3Qgb2JqZWN0IGAucmVkdWNlKClgIGltcGxlbWVudGF0aW9uLlxuICpcbiAqIEBwYXJhbSAge09iamVjdH0gICBzdWJqZWN0ICAgICAgVGhlIG9iamVjdCB0byByZWR1Y2Ugb3Zlci5cbiAqIEBwYXJhbSAge0Z1bmN0aW9ufSBmbiAgICAgICAgICAgVGhlIHJlZHVjZXIgZnVuY3Rpb24uXG4gKiBAcGFyYW0gIHttaXhlZH0gICAgaW5pdGlhbFZhbHVlIFRoZSBpbml0aWFsIHZhbHVlIGZvciB0aGUgcmVkdWNlciwgZGVmYXVsdHMgdG8gc3ViamVjdFswXS5cbiAqIEBwYXJhbSAge09iamVjdH0gICB0aGlzQ29udGV4dCAgVGhlIGNvbnRleHQgZm9yIHRoZSByZWR1Y2VyLlxuICogQHJldHVybiB7bWl4ZWR9ICAgICAgICAgICAgICAgICBUaGUgZmluYWwgcmVzdWx0LlxuICovXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGZhc3RSZWR1Y2VPYmplY3QgKHN1YmplY3QsIGZuLCBpbml0aWFsVmFsdWUsIHRoaXNDb250ZXh0KSB7XG4gIHZhciBrZXlzID0gT2JqZWN0LmtleXMoc3ViamVjdCksXG4gICAgICBsZW5ndGggPSBrZXlzLmxlbmd0aCxcbiAgICAgIGl0ZXJhdG9yID0gdGhpc0NvbnRleHQgIT09IHVuZGVmaW5lZCA/IGJpbmRJbnRlcm5hbDQoZm4sIHRoaXNDb250ZXh0KSA6IGZuLFxuICAgICAgaSwga2V5LCByZXN1bHQ7XG5cbiAgaWYgKGluaXRpYWxWYWx1ZSA9PT0gdW5kZWZpbmVkKSB7XG4gICAgaSA9IDE7XG4gICAgcmVzdWx0ID0gc3ViamVjdFtrZXlzWzBdXTtcbiAgfVxuICBlbHNlIHtcbiAgICBpID0gMDtcbiAgICByZXN1bHQgPSBpbml0aWFsVmFsdWU7XG4gIH1cblxuICBmb3IgKDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAga2V5ID0ga2V5c1tpXTtcbiAgICByZXN1bHQgPSBpdGVyYXRvcihyZXN1bHQsIHN1YmplY3Rba2V5XSwga2V5LCBzdWJqZWN0KTtcbiAgfVxuXG4gIHJldHVybiByZXN1bHQ7XG59O1xuIiwiJ3VzZSBzdHJpY3QnO1xuXG52YXIgcmVkdWNlQXJyYXkgPSByZXF1aXJlKCcuL2FycmF5L3JlZHVjZScpLFxuICAgIHJlZHVjZU9iamVjdCA9IHJlcXVpcmUoJy4vb2JqZWN0L3JlZHVjZScpO1xuXG4vKipcbiAqICMgUmVkdWNlXG4gKlxuICogQSBmYXN0IGAucmVkdWNlKClgIGltcGxlbWVudGF0aW9uLlxuICpcbiAqIEBwYXJhbSAge0FycmF5fE9iamVjdH0gc3ViamVjdCAgICAgIFRoZSBhcnJheSBvciBvYmplY3QgdG8gcmVkdWNlIG92ZXIuXG4gKiBAcGFyYW0gIHtGdW5jdGlvbn0gICAgIGZuICAgICAgICAgICBUaGUgcmVkdWNlciBmdW5jdGlvbi5cbiAqIEBwYXJhbSAge21peGVkfSAgICAgICAgaW5pdGlhbFZhbHVlIFRoZSBpbml0aWFsIHZhbHVlIGZvciB0aGUgcmVkdWNlciwgZGVmYXVsdHMgdG8gc3ViamVjdFswXS5cbiAqIEBwYXJhbSAge09iamVjdH0gICAgICAgdGhpc0NvbnRleHQgIFRoZSBjb250ZXh0IGZvciB0aGUgcmVkdWNlci5cbiAqIEByZXR1cm4ge0FycmF5fE9iamVjdH0gICAgICAgICAgICAgIFRoZSBhcnJheSBvciBvYmplY3QgY29udGFpbmluZyB0aGUgcmVzdWx0cy5cbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBmdW5jdGlvbiBmYXN0UmVkdWNlIChzdWJqZWN0LCBmbiwgaW5pdGlhbFZhbHVlLCB0aGlzQ29udGV4dCkge1xuICBpZiAoc3ViamVjdCBpbnN0YW5jZW9mIEFycmF5KSB7XG4gICAgcmV0dXJuIHJlZHVjZUFycmF5KHN1YmplY3QsIGZuLCBpbml0aWFsVmFsdWUsIHRoaXNDb250ZXh0KTtcbiAgfVxuICBlbHNlIHtcbiAgICByZXR1cm4gcmVkdWNlT2JqZWN0KHN1YmplY3QsIGZuLCBpbml0aWFsVmFsdWUsIHRoaXNDb250ZXh0KTtcbiAgfVxufTsiLCIvKiogZ2VuZXJhdGUgdW5pcXVlIGlkIGZvciBzZWxlY3RvciAqL1xyXG52YXIgY291bnRlciA9IERhdGUubm93KCkgJSAxZTk7XHJcblxyXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGdldFVpZCgpe1xyXG5cdHJldHVybiAoTWF0aC5yYW5kb20oKSAqIDFlOSA+Pj4gMCkgKyAoY291bnRlcisrKTtcclxufTsiLCIvKmdsb2JhbCB3aW5kb3cqL1xuXG4vKipcbiAqIENoZWNrIGlmIG9iamVjdCBpcyBkb20gbm9kZS5cbiAqXG4gKiBAcGFyYW0ge09iamVjdH0gdmFsXG4gKiBAcmV0dXJuIHtCb29sZWFufVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIGlzTm9kZSh2YWwpe1xuICBpZiAoIXZhbCB8fCB0eXBlb2YgdmFsICE9PSAnb2JqZWN0JykgcmV0dXJuIGZhbHNlO1xuICBpZiAod2luZG93ICYmICdvYmplY3QnID09IHR5cGVvZiB3aW5kb3cuTm9kZSkgcmV0dXJuIHZhbCBpbnN0YW5jZW9mIHdpbmRvdy5Ob2RlO1xuICByZXR1cm4gJ251bWJlcicgPT0gdHlwZW9mIHZhbC5ub2RlVHlwZSAmJiAnc3RyaW5nJyA9PSB0eXBlb2YgdmFsLm5vZGVOYW1lO1xufVxuIiwiLyoqXG4gKiBTdXBwb3J0ZWQgU1ZHIGF0dHJpYnV0ZXNcbiAqL1xuXG5leHBvcnRzLmF0dHJpYnV0ZXMgPSB7XG4gICdjeCc6IHRydWUsXG4gICdjeSc6IHRydWUsXG4gICdkJzogdHJ1ZSxcbiAgJ2R4JzogdHJ1ZSxcbiAgJ2R5JzogdHJ1ZSxcbiAgJ2ZpbGwnOiB0cnVlLFxuICAnZmlsbE9wYWNpdHknOiB0cnVlLFxuICAnZm9udEZhbWlseSc6IHRydWUsXG4gICdmb250U2l6ZSc6IHRydWUsXG4gICdmeCc6IHRydWUsXG4gICdmeSc6IHRydWUsXG4gICdncmFkaWVudFRyYW5zZm9ybSc6IHRydWUsXG4gICdncmFkaWVudFVuaXRzJzogdHJ1ZSxcbiAgJ21hcmtlckVuZCc6IHRydWUsXG4gICdtYXJrZXJNaWQnOiB0cnVlLFxuICAnbWFya2VyU3RhcnQnOiB0cnVlLFxuICAnb2Zmc2V0JzogdHJ1ZSxcbiAgJ29wYWNpdHknOiB0cnVlLFxuICAncGF0dGVybkNvbnRlbnRVbml0cyc6IHRydWUsXG4gICdwYXR0ZXJuVW5pdHMnOiB0cnVlLFxuICAncG9pbnRzJzogdHJ1ZSxcbiAgJ3ByZXNlcnZlQXNwZWN0UmF0aW8nOiB0cnVlLFxuICAncic6IHRydWUsXG4gICdyeCc6IHRydWUsXG4gICdyeSc6IHRydWUsXG4gICdzcHJlYWRNZXRob2QnOiB0cnVlLFxuICAnc3RvcENvbG9yJzogdHJ1ZSxcbiAgJ3N0b3BPcGFjaXR5JzogdHJ1ZSxcbiAgJ3N0cm9rZSc6IHRydWUsXG4gICdzdHJva2VEYXNoYXJyYXknOiB0cnVlLFxuICAnc3Ryb2tlTGluZWNhcCc6IHRydWUsXG4gICdzdHJva2VPcGFjaXR5JzogdHJ1ZSxcbiAgJ3N0cm9rZVdpZHRoJzogdHJ1ZSxcbiAgJ3RleHRBbmNob3InOiB0cnVlLFxuICAndHJhbnNmb3JtJzogdHJ1ZSxcbiAgJ3ZlcnNpb24nOiB0cnVlLFxuICAndmlld0JveCc6IHRydWUsXG4gICd4MSc6IHRydWUsXG4gICd4Mic6IHRydWUsXG4gICd4JzogdHJ1ZSxcbiAgJ3kxJzogdHJ1ZSxcbiAgJ3kyJzogdHJ1ZSxcbiAgJ3knOiB0cnVlXG59XG5cbi8qKlxuICogQXJlIGVsZW1lbnQncyBhdHRyaWJ1dGVzIFNWRz9cbiAqXG4gKiBAcGFyYW0ge1N0cmluZ30gYXR0clxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gZnVuY3Rpb24gKGF0dHIpIHtcbiAgcmV0dXJuIGF0dHIgaW4gZXhwb3J0cy5hdHRyaWJ1dGVzXG59XG4iLCIvKipcbiAqIFN1cHBvcnRlZCBTVkcgZWxlbWVudHNcbiAqXG4gKiBAdHlwZSB7QXJyYXl9XG4gKi9cblxuZXhwb3J0cy5lbGVtZW50cyA9IHtcbiAgJ2FuaW1hdGUnOiB0cnVlLFxuICAnY2lyY2xlJzogdHJ1ZSxcbiAgJ2RlZnMnOiB0cnVlLFxuICAnZWxsaXBzZSc6IHRydWUsXG4gICdnJzogdHJ1ZSxcbiAgJ2xpbmUnOiB0cnVlLFxuICAnbGluZWFyR3JhZGllbnQnOiB0cnVlLFxuICAnbWFzayc6IHRydWUsXG4gICdwYXRoJzogdHJ1ZSxcbiAgJ3BhdHRlcm4nOiB0cnVlLFxuICAncG9seWdvbic6IHRydWUsXG4gICdwb2x5bGluZSc6IHRydWUsXG4gICdyYWRpYWxHcmFkaWVudCc6IHRydWUsXG4gICdyZWN0JzogdHJ1ZSxcbiAgJ3N0b3AnOiB0cnVlLFxuICAnc3ZnJzogdHJ1ZSxcbiAgJ3RleHQnOiB0cnVlLFxuICAndHNwYW4nOiB0cnVlXG59XG5cbi8qKlxuICogSXMgZWxlbWVudCdzIG5hbWVzcGFjZSBTVkc/XG4gKlxuICogQHBhcmFtIHtTdHJpbmd9IG5hbWVcbiAqL1xuXG5leHBvcnRzLmlzRWxlbWVudCA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gIHJldHVybiBuYW1lIGluIGV4cG9ydHMuZWxlbWVudHNcbn1cbiIsIid1c2Ugc3RyaWN0J1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uKHRhcmdldCkge1xuICB0YXJnZXQgPSB0YXJnZXQgfHwge31cblxuICBmb3IgKHZhciBpID0gMTsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuICAgIHZhciBzb3VyY2UgPSBhcmd1bWVudHNbaV1cbiAgICBpZiAoIXNvdXJjZSkgY29udGludWVcblxuICAgIE9iamVjdC5nZXRPd25Qcm9wZXJ0eU5hbWVzKHNvdXJjZSkuZm9yRWFjaChmdW5jdGlvbihrZXkpIHtcbiAgICAgIGlmICh1bmRlZmluZWQgPT09IHRhcmdldFtrZXldKVxuICAgICAgICB0YXJnZXRba2V5XSA9IHNvdXJjZVtrZXldXG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiB0YXJnZXRcbn1cbiIsIihmdW5jdGlvbiAocm9vdCwgZmFjdG9yeSl7XG4gICd1c2Ugc3RyaWN0JztcblxuICAvKmlzdGFuYnVsIGlnbm9yZSBuZXh0OmNhbnQgdGVzdCovXG4gIGlmICh0eXBlb2YgbW9kdWxlID09PSAnb2JqZWN0JyAmJiB0eXBlb2YgbW9kdWxlLmV4cG9ydHMgPT09ICdvYmplY3QnKSB7XG4gICAgbW9kdWxlLmV4cG9ydHMgPSBmYWN0b3J5KCk7XG4gIH0gZWxzZSBpZiAodHlwZW9mIGRlZmluZSA9PT0gJ2Z1bmN0aW9uJyAmJiBkZWZpbmUuYW1kKSB7XG4gICAgLy8gQU1ELiBSZWdpc3RlciBhcyBhbiBhbm9ueW1vdXMgbW9kdWxlLlxuICAgIGRlZmluZShbXSwgZmFjdG9yeSk7XG4gIH0gZWxzZSB7XG4gICAgLy8gQnJvd3NlciBnbG9iYWxzXG4gICAgcm9vdC5vYmplY3RQYXRoID0gZmFjdG9yeSgpO1xuICB9XG59KSh0aGlzLCBmdW5jdGlvbigpe1xuICAndXNlIHN0cmljdCc7XG5cbiAgdmFyXG4gICAgdG9TdHIgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nLFxuICAgIF9oYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHk7XG5cbiAgZnVuY3Rpb24gaXNFbXB0eSh2YWx1ZSl7XG4gICAgaWYgKCF2YWx1ZSkge1xuICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIGlmIChpc0FycmF5KHZhbHVlKSAmJiB2YWx1ZS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfSBlbHNlIGlmICghaXNTdHJpbmcodmFsdWUpKSB7XG4gICAgICAgIGZvciAodmFyIGkgaW4gdmFsdWUpIHtcbiAgICAgICAgICAgIGlmIChfaGFzT3duUHJvcGVydHkuY2FsbCh2YWx1ZSwgaSkpIHtcbiAgICAgICAgICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcmV0dXJuIHRydWU7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuXG4gIGZ1bmN0aW9uIHRvU3RyaW5nKHR5cGUpe1xuICAgIHJldHVybiB0b1N0ci5jYWxsKHR5cGUpO1xuICB9XG5cbiAgZnVuY3Rpb24gaXNOdW1iZXIodmFsdWUpe1xuICAgIHJldHVybiB0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInIHx8IHRvU3RyaW5nKHZhbHVlKSA9PT0gXCJbb2JqZWN0IE51bWJlcl1cIjtcbiAgfVxuXG4gIGZ1bmN0aW9uIGlzU3RyaW5nKG9iail7XG4gICAgcmV0dXJuIHR5cGVvZiBvYmogPT09ICdzdHJpbmcnIHx8IHRvU3RyaW5nKG9iaikgPT09IFwiW29iamVjdCBTdHJpbmddXCI7XG4gIH1cblxuICBmdW5jdGlvbiBpc09iamVjdChvYmope1xuICAgIHJldHVybiB0eXBlb2Ygb2JqID09PSAnb2JqZWN0JyAmJiB0b1N0cmluZyhvYmopID09PSBcIltvYmplY3QgT2JqZWN0XVwiO1xuICB9XG5cbiAgZnVuY3Rpb24gaXNBcnJheShvYmope1xuICAgIHJldHVybiB0eXBlb2Ygb2JqID09PSAnb2JqZWN0JyAmJiB0eXBlb2Ygb2JqLmxlbmd0aCA9PT0gJ251bWJlcicgJiYgdG9TdHJpbmcob2JqKSA9PT0gJ1tvYmplY3QgQXJyYXldJztcbiAgfVxuXG4gIGZ1bmN0aW9uIGlzQm9vbGVhbihvYmope1xuICAgIHJldHVybiB0eXBlb2Ygb2JqID09PSAnYm9vbGVhbicgfHwgdG9TdHJpbmcob2JqKSA9PT0gJ1tvYmplY3QgQm9vbGVhbl0nO1xuICB9XG5cbiAgZnVuY3Rpb24gZ2V0S2V5KGtleSl7XG4gICAgdmFyIGludEtleSA9IHBhcnNlSW50KGtleSk7XG4gICAgaWYgKGludEtleS50b1N0cmluZygpID09PSBrZXkpIHtcbiAgICAgIHJldHVybiBpbnRLZXk7XG4gICAgfVxuICAgIHJldHVybiBrZXk7XG4gIH1cblxuICBmdW5jdGlvbiBzZXQob2JqLCBwYXRoLCB2YWx1ZSwgZG9Ob3RSZXBsYWNlKXtcbiAgICBpZiAoaXNOdW1iZXIocGF0aCkpIHtcbiAgICAgIHBhdGggPSBbcGF0aF07XG4gICAgfVxuICAgIGlmIChpc0VtcHR5KHBhdGgpKSB7XG4gICAgICByZXR1cm4gb2JqO1xuICAgIH1cbiAgICBpZiAoaXNTdHJpbmcocGF0aCkpIHtcbiAgICAgIHJldHVybiBzZXQob2JqLCBwYXRoLnNwbGl0KCcuJykubWFwKGdldEtleSksIHZhbHVlLCBkb05vdFJlcGxhY2UpO1xuICAgIH1cbiAgICB2YXIgY3VycmVudFBhdGggPSBwYXRoWzBdO1xuXG4gICAgaWYgKHBhdGgubGVuZ3RoID09PSAxKSB7XG4gICAgICB2YXIgb2xkVmFsID0gb2JqW2N1cnJlbnRQYXRoXTtcbiAgICAgIGlmIChvbGRWYWwgPT09IHZvaWQgMCB8fCAhZG9Ob3RSZXBsYWNlKSB7XG4gICAgICAgIG9ialtjdXJyZW50UGF0aF0gPSB2YWx1ZTtcbiAgICAgIH1cbiAgICAgIHJldHVybiBvbGRWYWw7XG4gICAgfVxuXG4gICAgaWYgKG9ialtjdXJyZW50UGF0aF0gPT09IHZvaWQgMCkge1xuICAgICAgLy9jaGVjayBpZiB3ZSBhc3N1bWUgYW4gYXJyYXlcbiAgICAgIGlmKGlzTnVtYmVyKHBhdGhbMV0pKSB7XG4gICAgICAgIG9ialtjdXJyZW50UGF0aF0gPSBbXTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIG9ialtjdXJyZW50UGF0aF0gPSB7fTtcbiAgICAgIH1cbiAgICB9XG5cbiAgICByZXR1cm4gc2V0KG9ialtjdXJyZW50UGF0aF0sIHBhdGguc2xpY2UoMSksIHZhbHVlLCBkb05vdFJlcGxhY2UpO1xuICB9XG5cbiAgZnVuY3Rpb24gZGVsKG9iaiwgcGF0aCkge1xuICAgIGlmIChpc051bWJlcihwYXRoKSkge1xuICAgICAgcGF0aCA9IFtwYXRoXTtcbiAgICB9XG5cbiAgICBpZiAoaXNFbXB0eShvYmopKSB7XG4gICAgICByZXR1cm4gdm9pZCAwO1xuICAgIH1cblxuICAgIGlmIChpc0VtcHR5KHBhdGgpKSB7XG4gICAgICByZXR1cm4gb2JqO1xuICAgIH1cbiAgICBpZihpc1N0cmluZyhwYXRoKSkge1xuICAgICAgcmV0dXJuIGRlbChvYmosIHBhdGguc3BsaXQoJy4nKSk7XG4gICAgfVxuXG4gICAgdmFyIGN1cnJlbnRQYXRoID0gZ2V0S2V5KHBhdGhbMF0pO1xuICAgIHZhciBvbGRWYWwgPSBvYmpbY3VycmVudFBhdGhdO1xuXG4gICAgaWYocGF0aC5sZW5ndGggPT09IDEpIHtcbiAgICAgIGlmIChvbGRWYWwgIT09IHZvaWQgMCkge1xuICAgICAgICBpZiAoaXNBcnJheShvYmopKSB7XG4gICAgICAgICAgb2JqLnNwbGljZShjdXJyZW50UGF0aCwgMSk7XG4gICAgICAgIH0gZWxzZSB7XG4gICAgICAgICAgZGVsZXRlIG9ialtjdXJyZW50UGF0aF07XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKG9ialtjdXJyZW50UGF0aF0gIT09IHZvaWQgMCkge1xuICAgICAgICByZXR1cm4gZGVsKG9ialtjdXJyZW50UGF0aF0sIHBhdGguc2xpY2UoMSkpO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBvYmo7XG4gIH1cblxuICB2YXIgb2JqZWN0UGF0aCA9IGZ1bmN0aW9uKG9iaikge1xuICAgIHJldHVybiBPYmplY3Qua2V5cyhvYmplY3RQYXRoKS5yZWR1Y2UoZnVuY3Rpb24ocHJveHksIHByb3ApIHtcbiAgICAgIGlmICh0eXBlb2Ygb2JqZWN0UGF0aFtwcm9wXSA9PT0gJ2Z1bmN0aW9uJykge1xuICAgICAgICBwcm94eVtwcm9wXSA9IG9iamVjdFBhdGhbcHJvcF0uYmluZChvYmplY3RQYXRoLCBvYmopO1xuICAgICAgfVxuXG4gICAgICByZXR1cm4gcHJveHk7XG4gICAgfSwge30pO1xuICB9O1xuXG4gIG9iamVjdFBhdGguaGFzID0gZnVuY3Rpb24gKG9iaiwgcGF0aCkge1xuICAgIGlmIChpc0VtcHR5KG9iaikpIHtcbiAgICAgIHJldHVybiBmYWxzZTtcbiAgICB9XG5cbiAgICBpZiAoaXNOdW1iZXIocGF0aCkpIHtcbiAgICAgIHBhdGggPSBbcGF0aF07XG4gICAgfSBlbHNlIGlmIChpc1N0cmluZyhwYXRoKSkge1xuICAgICAgcGF0aCA9IHBhdGguc3BsaXQoJy4nKTtcbiAgICB9XG5cbiAgICBpZiAoaXNFbXB0eShwYXRoKSB8fCBwYXRoLmxlbmd0aCA9PT0gMCkge1xuICAgICAgcmV0dXJuIGZhbHNlO1xuICAgIH1cblxuICAgIGZvciAodmFyIGkgPSAwOyBpIDwgcGF0aC5sZW5ndGg7IGkrKykge1xuICAgICAgdmFyIGogPSBwYXRoW2ldO1xuICAgICAgaWYgKChpc09iamVjdChvYmopIHx8IGlzQXJyYXkob2JqKSkgJiYgX2hhc093blByb3BlcnR5LmNhbGwob2JqLCBqKSkge1xuICAgICAgICBvYmogPSBvYmpbal07XG4gICAgICB9IGVsc2Uge1xuICAgICAgICByZXR1cm4gZmFsc2U7XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIHRydWU7XG4gIH07XG5cbiAgb2JqZWN0UGF0aC5lbnN1cmVFeGlzdHMgPSBmdW5jdGlvbiAob2JqLCBwYXRoLCB2YWx1ZSl7XG4gICAgcmV0dXJuIHNldChvYmosIHBhdGgsIHZhbHVlLCB0cnVlKTtcbiAgfTtcblxuICBvYmplY3RQYXRoLnNldCA9IGZ1bmN0aW9uIChvYmosIHBhdGgsIHZhbHVlLCBkb05vdFJlcGxhY2Upe1xuICAgIHJldHVybiBzZXQob2JqLCBwYXRoLCB2YWx1ZSwgZG9Ob3RSZXBsYWNlKTtcbiAgfTtcblxuICBvYmplY3RQYXRoLmluc2VydCA9IGZ1bmN0aW9uIChvYmosIHBhdGgsIHZhbHVlLCBhdCl7XG4gICAgdmFyIGFyciA9IG9iamVjdFBhdGguZ2V0KG9iaiwgcGF0aCk7XG4gICAgYXQgPSB+fmF0O1xuICAgIGlmICghaXNBcnJheShhcnIpKSB7XG4gICAgICBhcnIgPSBbXTtcbiAgICAgIG9iamVjdFBhdGguc2V0KG9iaiwgcGF0aCwgYXJyKTtcbiAgICB9XG4gICAgYXJyLnNwbGljZShhdCwgMCwgdmFsdWUpO1xuICB9O1xuXG4gIG9iamVjdFBhdGguZW1wdHkgPSBmdW5jdGlvbihvYmosIHBhdGgpIHtcbiAgICBpZiAoaXNFbXB0eShwYXRoKSkge1xuICAgICAgcmV0dXJuIG9iajtcbiAgICB9XG4gICAgaWYgKGlzRW1wdHkob2JqKSkge1xuICAgICAgcmV0dXJuIHZvaWQgMDtcbiAgICB9XG5cbiAgICB2YXIgdmFsdWUsIGk7XG4gICAgaWYgKCEodmFsdWUgPSBvYmplY3RQYXRoLmdldChvYmosIHBhdGgpKSkge1xuICAgICAgcmV0dXJuIG9iajtcbiAgICB9XG5cbiAgICBpZiAoaXNTdHJpbmcodmFsdWUpKSB7XG4gICAgICByZXR1cm4gb2JqZWN0UGF0aC5zZXQob2JqLCBwYXRoLCAnJyk7XG4gICAgfSBlbHNlIGlmIChpc0Jvb2xlYW4odmFsdWUpKSB7XG4gICAgICByZXR1cm4gb2JqZWN0UGF0aC5zZXQob2JqLCBwYXRoLCBmYWxzZSk7XG4gICAgfSBlbHNlIGlmIChpc051bWJlcih2YWx1ZSkpIHtcbiAgICAgIHJldHVybiBvYmplY3RQYXRoLnNldChvYmosIHBhdGgsIDApO1xuICAgIH0gZWxzZSBpZiAoaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIHZhbHVlLmxlbmd0aCA9IDA7XG4gICAgfSBlbHNlIGlmIChpc09iamVjdCh2YWx1ZSkpIHtcbiAgICAgIGZvciAoaSBpbiB2YWx1ZSkge1xuICAgICAgICBpZiAoX2hhc093blByb3BlcnR5LmNhbGwodmFsdWUsIGkpKSB7XG4gICAgICAgICAgZGVsZXRlIHZhbHVlW2ldO1xuICAgICAgICB9XG4gICAgICB9XG4gICAgfSBlbHNlIHtcbiAgICAgIHJldHVybiBvYmplY3RQYXRoLnNldChvYmosIHBhdGgsIG51bGwpO1xuICAgIH1cbiAgfTtcblxuICBvYmplY3RQYXRoLnB1c2ggPSBmdW5jdGlvbiAob2JqLCBwYXRoIC8qLCB2YWx1ZXMgKi8pe1xuICAgIHZhciBhcnIgPSBvYmplY3RQYXRoLmdldChvYmosIHBhdGgpO1xuICAgIGlmICghaXNBcnJheShhcnIpKSB7XG4gICAgICBhcnIgPSBbXTtcbiAgICAgIG9iamVjdFBhdGguc2V0KG9iaiwgcGF0aCwgYXJyKTtcbiAgICB9XG5cbiAgICBhcnIucHVzaC5hcHBseShhcnIsIEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cywgMikpO1xuICB9O1xuXG4gIG9iamVjdFBhdGguY29hbGVzY2UgPSBmdW5jdGlvbiAob2JqLCBwYXRocywgZGVmYXVsdFZhbHVlKSB7XG4gICAgdmFyIHZhbHVlO1xuXG4gICAgZm9yICh2YXIgaSA9IDAsIGxlbiA9IHBhdGhzLmxlbmd0aDsgaSA8IGxlbjsgaSsrKSB7XG4gICAgICBpZiAoKHZhbHVlID0gb2JqZWN0UGF0aC5nZXQob2JqLCBwYXRoc1tpXSkpICE9PSB2b2lkIDApIHtcbiAgICAgICAgcmV0dXJuIHZhbHVlO1xuICAgICAgfVxuICAgIH1cblxuICAgIHJldHVybiBkZWZhdWx0VmFsdWU7XG4gIH07XG5cbiAgb2JqZWN0UGF0aC5nZXQgPSBmdW5jdGlvbiAob2JqLCBwYXRoLCBkZWZhdWx0VmFsdWUpe1xuICAgIGlmIChpc051bWJlcihwYXRoKSkge1xuICAgICAgcGF0aCA9IFtwYXRoXTtcbiAgICB9XG4gICAgaWYgKGlzRW1wdHkocGF0aCkpIHtcbiAgICAgIHJldHVybiBvYmo7XG4gICAgfVxuICAgIGlmIChpc0VtcHR5KG9iaikpIHtcbiAgICAgIHJldHVybiBkZWZhdWx0VmFsdWU7XG4gICAgfVxuICAgIGlmIChpc1N0cmluZyhwYXRoKSkge1xuICAgICAgcmV0dXJuIG9iamVjdFBhdGguZ2V0KG9iaiwgcGF0aC5zcGxpdCgnLicpLCBkZWZhdWx0VmFsdWUpO1xuICAgIH1cblxuICAgIHZhciBjdXJyZW50UGF0aCA9IGdldEtleShwYXRoWzBdKTtcblxuICAgIGlmIChwYXRoLmxlbmd0aCA9PT0gMSkge1xuICAgICAgaWYgKG9ialtjdXJyZW50UGF0aF0gPT09IHZvaWQgMCkge1xuICAgICAgICByZXR1cm4gZGVmYXVsdFZhbHVlO1xuICAgICAgfVxuICAgICAgcmV0dXJuIG9ialtjdXJyZW50UGF0aF07XG4gICAgfVxuXG4gICAgcmV0dXJuIG9iamVjdFBhdGguZ2V0KG9ialtjdXJyZW50UGF0aF0sIHBhdGguc2xpY2UoMSksIGRlZmF1bHRWYWx1ZSk7XG4gIH07XG5cbiAgb2JqZWN0UGF0aC5kZWwgPSBmdW5jdGlvbihvYmosIHBhdGgpIHtcbiAgICByZXR1cm4gZGVsKG9iaiwgcGF0aCk7XG4gIH07XG5cbiAgcmV0dXJuIG9iamVjdFBhdGg7XG59KTtcbiIsIlxuXG4vL1xuLy8gR2VuZXJhdGVkIG9uIFR1ZSBEZWMgMTYgMjAxNCAxMjoxMzo0NyBHTVQrMDEwMCAoQ0VUKSBieSBDaGFybGllIFJvYmJpbnMsIFBhb2xvIEZyYWdvbWVuaSAmIHRoZSBDb250cmlidXRvcnMgKFVzaW5nIENvZGVzdXJnZW9uKS5cbi8vIFZlcnNpb24gMS4yLjZcbi8vXG5cbihmdW5jdGlvbiAoZXhwb3J0cykge1xuXG4vKlxuICogYnJvd3Nlci5qczogQnJvd3NlciBzcGVjaWZpYyBmdW5jdGlvbmFsaXR5IGZvciBkaXJlY3Rvci5cbiAqXG4gKiAoQykgMjAxMSwgQ2hhcmxpZSBSb2JiaW5zLCBQYW9sbyBGcmFnb21lbmksICYgdGhlIENvbnRyaWJ1dG9ycy5cbiAqIE1JVCBMSUNFTlNFXG4gKlxuICovXG5cbnZhciBkbG9jID0gZG9jdW1lbnQubG9jYXRpb247XG5cbmZ1bmN0aW9uIGRsb2NIYXNoRW1wdHkoKSB7XG4gIC8vIE5vbi1JRSBicm93c2VycyByZXR1cm4gJycgd2hlbiB0aGUgYWRkcmVzcyBiYXIgc2hvd3MgJyMnOyBEaXJlY3RvcidzIGxvZ2ljXG4gIC8vIGFzc3VtZXMgYm90aCBtZWFuIGVtcHR5LlxuICByZXR1cm4gZGxvYy5oYXNoID09PSAnJyB8fCBkbG9jLmhhc2ggPT09ICcjJztcbn1cblxudmFyIGxpc3RlbmVyID0ge1xuICBtb2RlOiAnbW9kZXJuJyxcbiAgaGFzaDogZGxvYy5oYXNoLFxuICBoaXN0b3J5OiBmYWxzZSxcblxuICBjaGVjazogZnVuY3Rpb24gKCkge1xuICAgIHZhciBoID0gZGxvYy5oYXNoO1xuICAgIGlmIChoICE9IHRoaXMuaGFzaCkge1xuICAgICAgdGhpcy5oYXNoID0gaDtcbiAgICAgIHRoaXMub25IYXNoQ2hhbmdlZCgpO1xuICAgIH1cbiAgfSxcblxuICBmaXJlOiBmdW5jdGlvbiAoKSB7XG4gICAgaWYgKHRoaXMubW9kZSA9PT0gJ21vZGVybicpIHtcbiAgICAgIHRoaXMuaGlzdG9yeSA9PT0gdHJ1ZSA/IHdpbmRvdy5vbnBvcHN0YXRlKCkgOiB3aW5kb3cub25oYXNoY2hhbmdlKCk7XG4gICAgfVxuICAgIGVsc2Uge1xuICAgICAgdGhpcy5vbkhhc2hDaGFuZ2VkKCk7XG4gICAgfVxuICB9LFxuXG4gIGluaXQ6IGZ1bmN0aW9uIChmbiwgaGlzdG9yeSkge1xuICAgIHZhciBzZWxmID0gdGhpcztcbiAgICB0aGlzLmhpc3RvcnkgPSBoaXN0b3J5O1xuXG4gICAgaWYgKCFSb3V0ZXIubGlzdGVuZXJzKSB7XG4gICAgICBSb3V0ZXIubGlzdGVuZXJzID0gW107XG4gICAgfVxuXG4gICAgZnVuY3Rpb24gb25jaGFuZ2Uob25DaGFuZ2VFdmVudCkge1xuICAgICAgZm9yICh2YXIgaSA9IDAsIGwgPSBSb3V0ZXIubGlzdGVuZXJzLmxlbmd0aDsgaSA8IGw7IGkrKykge1xuICAgICAgICBSb3V0ZXIubGlzdGVuZXJzW2ldKG9uQ2hhbmdlRXZlbnQpO1xuICAgICAgfVxuICAgIH1cblxuICAgIC8vbm90ZSBJRTggaXMgYmVpbmcgY291bnRlZCBhcyAnbW9kZXJuJyBiZWNhdXNlIGl0IGhhcyB0aGUgaGFzaGNoYW5nZSBldmVudFxuICAgIGlmICgnb25oYXNoY2hhbmdlJyBpbiB3aW5kb3cgJiYgKGRvY3VtZW50LmRvY3VtZW50TW9kZSA9PT0gdW5kZWZpbmVkXG4gICAgICB8fCBkb2N1bWVudC5kb2N1bWVudE1vZGUgPiA3KSkge1xuICAgICAgLy8gQXQgbGVhc3QgZm9yIG5vdyBIVE1MNSBoaXN0b3J5IGlzIGF2YWlsYWJsZSBmb3IgJ21vZGVybicgYnJvd3NlcnMgb25seVxuICAgICAgaWYgKHRoaXMuaGlzdG9yeSA9PT0gdHJ1ZSkge1xuICAgICAgICAvLyBUaGVyZSBpcyBhbiBvbGQgYnVnIGluIENocm9tZSB0aGF0IGNhdXNlcyBvbnBvcHN0YXRlIHRvIGZpcmUgZXZlblxuICAgICAgICAvLyB1cG9uIGluaXRpYWwgcGFnZSBsb2FkLiBTaW5jZSB0aGUgaGFuZGxlciBpcyBydW4gbWFudWFsbHkgaW4gaW5pdCgpLFxuICAgICAgICAvLyB0aGlzIHdvdWxkIGNhdXNlIENocm9tZSB0byBydW4gaXQgdHdpc2UuIEN1cnJlbnRseSB0aGUgb25seVxuICAgICAgICAvLyB3b3JrYXJvdW5kIHNlZW1zIHRvIGJlIHRvIHNldCB0aGUgaGFuZGxlciBhZnRlciB0aGUgaW5pdGlhbCBwYWdlIGxvYWRcbiAgICAgICAgLy8gaHR0cDovL2NvZGUuZ29vZ2xlLmNvbS9wL2Nocm9taXVtL2lzc3Vlcy9kZXRhaWw/aWQ9NjMwNDBcbiAgICAgICAgc2V0VGltZW91dChmdW5jdGlvbigpIHtcbiAgICAgICAgICB3aW5kb3cub25wb3BzdGF0ZSA9IG9uY2hhbmdlO1xuICAgICAgICB9LCA1MDApO1xuICAgICAgfVxuICAgICAgZWxzZSB7XG4gICAgICAgIHdpbmRvdy5vbmhhc2hjaGFuZ2UgPSBvbmNoYW5nZTtcbiAgICAgIH1cbiAgICAgIHRoaXMubW9kZSA9ICdtb2Rlcm4nO1xuICAgIH1cbiAgICBlbHNlIHtcbiAgICAgIC8vXG4gICAgICAvLyBJRSBzdXBwb3J0LCBiYXNlZCBvbiBhIGNvbmNlcHQgYnkgRXJpayBBcnZpZHNvbiAuLi5cbiAgICAgIC8vXG4gICAgICB2YXIgZnJhbWUgPSBkb2N1bWVudC5jcmVhdGVFbGVtZW50KCdpZnJhbWUnKTtcbiAgICAgIGZyYW1lLmlkID0gJ3N0YXRlLWZyYW1lJztcbiAgICAgIGZyYW1lLnN0eWxlLmRpc3BsYXkgPSAnbm9uZSc7XG4gICAgICBkb2N1bWVudC5ib2R5LmFwcGVuZENoaWxkKGZyYW1lKTtcbiAgICAgIHRoaXMud3JpdGVGcmFtZSgnJyk7XG5cbiAgICAgIGlmICgnb25wcm9wZXJ0eWNoYW5nZScgaW4gZG9jdW1lbnQgJiYgJ2F0dGFjaEV2ZW50JyBpbiBkb2N1bWVudCkge1xuICAgICAgICBkb2N1bWVudC5hdHRhY2hFdmVudCgnb25wcm9wZXJ0eWNoYW5nZScsIGZ1bmN0aW9uICgpIHtcbiAgICAgICAgICBpZiAoZXZlbnQucHJvcGVydHlOYW1lID09PSAnbG9jYXRpb24nKSB7XG4gICAgICAgICAgICBzZWxmLmNoZWNrKCk7XG4gICAgICAgICAgfVxuICAgICAgICB9KTtcbiAgICAgIH1cblxuICAgICAgd2luZG93LnNldEludGVydmFsKGZ1bmN0aW9uICgpIHsgc2VsZi5jaGVjaygpOyB9LCA1MCk7XG5cbiAgICAgIHRoaXMub25IYXNoQ2hhbmdlZCA9IG9uY2hhbmdlO1xuICAgICAgdGhpcy5tb2RlID0gJ2xlZ2FjeSc7XG4gICAgfVxuXG4gICAgUm91dGVyLmxpc3RlbmVycy5wdXNoKGZuKTtcblxuICAgIHJldHVybiB0aGlzLm1vZGU7XG4gIH0sXG5cbiAgZGVzdHJveTogZnVuY3Rpb24gKGZuKSB7XG4gICAgaWYgKCFSb3V0ZXIgfHwgIVJvdXRlci5saXN0ZW5lcnMpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG5cbiAgICB2YXIgbGlzdGVuZXJzID0gUm91dGVyLmxpc3RlbmVycztcblxuICAgIGZvciAodmFyIGkgPSBsaXN0ZW5lcnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgIGlmIChsaXN0ZW5lcnNbaV0gPT09IGZuKSB7XG4gICAgICAgIGxpc3RlbmVycy5zcGxpY2UoaSwgMSk7XG4gICAgICB9XG4gICAgfVxuICB9LFxuXG4gIHNldEhhc2g6IGZ1bmN0aW9uIChzKSB7XG4gICAgLy8gTW96aWxsYSBhbHdheXMgYWRkcyBhbiBlbnRyeSB0byB0aGUgaGlzdG9yeVxuICAgIGlmICh0aGlzLm1vZGUgPT09ICdsZWdhY3knKSB7XG4gICAgICB0aGlzLndyaXRlRnJhbWUocyk7XG4gICAgfVxuXG4gICAgaWYgKHRoaXMuaGlzdG9yeSA9PT0gdHJ1ZSkge1xuICAgICAgd2luZG93Lmhpc3RvcnkucHVzaFN0YXRlKHt9LCBkb2N1bWVudC50aXRsZSwgcyk7XG4gICAgICAvLyBGaXJlIGFuIG9ucG9wc3RhdGUgZXZlbnQgbWFudWFsbHkgc2luY2UgcHVzaGluZyBkb2VzIG5vdCBvYnZpb3VzbHlcbiAgICAgIC8vIHRyaWdnZXIgdGhlIHBvcCBldmVudC5cbiAgICAgIHRoaXMuZmlyZSgpO1xuICAgIH0gZWxzZSB7XG4gICAgICBkbG9jLmhhc2ggPSAoc1swXSA9PT0gJy8nKSA/IHMgOiAnLycgKyBzO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfSxcblxuICB3cml0ZUZyYW1lOiBmdW5jdGlvbiAocykge1xuICAgIC8vIElFIHN1cHBvcnQuLi5cbiAgICB2YXIgZiA9IGRvY3VtZW50LmdldEVsZW1lbnRCeUlkKCdzdGF0ZS1mcmFtZScpO1xuICAgIHZhciBkID0gZi5jb250ZW50RG9jdW1lbnQgfHwgZi5jb250ZW50V2luZG93LmRvY3VtZW50O1xuICAgIGQub3BlbigpO1xuICAgIGQud3JpdGUoXCI8c2NyaXB0Pl9oYXNoID0gJ1wiICsgcyArIFwiJzsgb25sb2FkID0gcGFyZW50Lmxpc3RlbmVyLnN5bmNIYXNoOzxzY3JpcHQ+XCIpO1xuICAgIGQuY2xvc2UoKTtcbiAgfSxcblxuICBzeW5jSGFzaDogZnVuY3Rpb24gKCkge1xuICAgIC8vIElFIHN1cHBvcnQuLi5cbiAgICB2YXIgcyA9IHRoaXMuX2hhc2g7XG4gICAgaWYgKHMgIT0gZGxvYy5oYXNoKSB7XG4gICAgICBkbG9jLmhhc2ggPSBzO1xuICAgIH1cbiAgICByZXR1cm4gdGhpcztcbiAgfSxcblxuICBvbkhhc2hDaGFuZ2VkOiBmdW5jdGlvbiAoKSB7fVxufTtcblxudmFyIFJvdXRlciA9IGV4cG9ydHMuUm91dGVyID0gZnVuY3Rpb24gKHJvdXRlcykge1xuICBpZiAoISh0aGlzIGluc3RhbmNlb2YgUm91dGVyKSkgcmV0dXJuIG5ldyBSb3V0ZXIocm91dGVzKTtcblxuICB0aGlzLnBhcmFtcyAgID0ge307XG4gIHRoaXMucm91dGVzICAgPSB7fTtcbiAgdGhpcy5tZXRob2RzICA9IFsnb24nLCAnb25jZScsICdhZnRlcicsICdiZWZvcmUnXTtcbiAgdGhpcy5zY29wZSAgICA9IFtdO1xuICB0aGlzLl9tZXRob2RzID0ge307XG5cbiAgdGhpcy5faW5zZXJ0ID0gdGhpcy5pbnNlcnQ7XG4gIHRoaXMuaW5zZXJ0ID0gdGhpcy5pbnNlcnRFeDtcblxuICB0aGlzLmhpc3RvcnlTdXBwb3J0ID0gKHdpbmRvdy5oaXN0b3J5ICE9IG51bGwgPyB3aW5kb3cuaGlzdG9yeS5wdXNoU3RhdGUgOiBudWxsKSAhPSBudWxsXG5cbiAgdGhpcy5jb25maWd1cmUoKTtcbiAgdGhpcy5tb3VudChyb3V0ZXMgfHwge30pO1xufTtcblxuUm91dGVyLnByb3RvdHlwZS5pbml0ID0gZnVuY3Rpb24gKHIpIHtcbiAgdmFyIHNlbGYgPSB0aGlzXG4gICAgLCByb3V0ZVRvO1xuICB0aGlzLmhhbmRsZXIgPSBmdW5jdGlvbihvbkNoYW5nZUV2ZW50KSB7XG4gICAgdmFyIG5ld1VSTCA9IG9uQ2hhbmdlRXZlbnQgJiYgb25DaGFuZ2VFdmVudC5uZXdVUkwgfHwgd2luZG93LmxvY2F0aW9uLmhhc2g7XG4gICAgdmFyIHVybCA9IHNlbGYuaGlzdG9yeSA9PT0gdHJ1ZSA/IHNlbGYuZ2V0UGF0aCgpIDogbmV3VVJMLnJlcGxhY2UoLy4qIy8sICcnKTtcbiAgICBzZWxmLmRpc3BhdGNoKCdvbicsIHVybC5jaGFyQXQoMCkgPT09ICcvJyA/IHVybCA6ICcvJyArIHVybCk7XG4gIH07XG5cbiAgbGlzdGVuZXIuaW5pdCh0aGlzLmhhbmRsZXIsIHRoaXMuaGlzdG9yeSk7XG5cbiAgaWYgKHRoaXMuaGlzdG9yeSA9PT0gZmFsc2UpIHtcbiAgICBpZiAoZGxvY0hhc2hFbXB0eSgpICYmIHIpIHtcbiAgICAgIGRsb2MuaGFzaCA9IHI7XG4gICAgfSBlbHNlIGlmICghZGxvY0hhc2hFbXB0eSgpKSB7XG4gICAgICBzZWxmLmRpc3BhdGNoKCdvbicsICcvJyArIGRsb2MuaGFzaC5yZXBsYWNlKC9eKCNcXC98I3xcXC8pLywgJycpKTtcbiAgICB9XG4gIH1cbiAgZWxzZSB7XG4gICAgaWYgKHRoaXMuY29udmVydF9oYXNoX2luX2luaXQpIHtcbiAgICAgIC8vIFVzZSBoYXNoIGFzIHJvdXRlXG4gICAgICByb3V0ZVRvID0gZGxvY0hhc2hFbXB0eSgpICYmIHIgPyByIDogIWRsb2NIYXNoRW1wdHkoKSA/IGRsb2MuaGFzaC5yZXBsYWNlKC9eIy8sICcnKSA6IG51bGw7XG4gICAgICBpZiAocm91dGVUbykge1xuICAgICAgICB3aW5kb3cuaGlzdG9yeS5yZXBsYWNlU3RhdGUoe30sIGRvY3VtZW50LnRpdGxlLCByb3V0ZVRvKTtcbiAgICAgIH1cbiAgICB9XG4gICAgZWxzZSB7XG4gICAgICAvLyBVc2UgY2Fub25pY2FsIHVybFxuICAgICAgcm91dGVUbyA9IHRoaXMuZ2V0UGF0aCgpO1xuICAgIH1cblxuICAgIC8vIFJvdXRlciBoYXMgYmVlbiBpbml0aWFsaXplZCwgYnV0IGR1ZSB0byB0aGUgY2hyb21lIGJ1ZyBpdCB3aWxsIG5vdFxuICAgIC8vIHlldCBhY3R1YWxseSByb3V0ZSBIVE1MNSBoaXN0b3J5IHN0YXRlIGNoYW5nZXMuIFRodXMsIGRlY2lkZSBpZiBzaG91bGQgcm91dGUuXG4gICAgaWYgKHJvdXRlVG8gfHwgdGhpcy5ydW5faW5faW5pdCA9PT0gdHJ1ZSkge1xuICAgICAgdGhpcy5oYW5kbGVyKCk7XG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLmV4cGxvZGUgPSBmdW5jdGlvbiAoKSB7XG4gIHZhciB2ID0gdGhpcy5oaXN0b3J5ID09PSB0cnVlID8gdGhpcy5nZXRQYXRoKCkgOiBkbG9jLmhhc2g7XG4gIGlmICh2LmNoYXJBdCgxKSA9PT0gJy8nKSB7IHY9di5zbGljZSgxKSB9XG4gIHJldHVybiB2LnNsaWNlKDEsIHYubGVuZ3RoKS5zcGxpdChcIi9cIik7XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLnNldFJvdXRlID0gZnVuY3Rpb24gKGksIHYsIHZhbCkge1xuICB2YXIgdXJsID0gdGhpcy5leHBsb2RlKCk7XG5cbiAgaWYgKHR5cGVvZiBpID09PSAnbnVtYmVyJyAmJiB0eXBlb2YgdiA9PT0gJ3N0cmluZycpIHtcbiAgICB1cmxbaV0gPSB2O1xuICB9XG4gIGVsc2UgaWYgKHR5cGVvZiB2YWwgPT09ICdzdHJpbmcnKSB7XG4gICAgdXJsLnNwbGljZShpLCB2LCBzKTtcbiAgfVxuICBlbHNlIHtcbiAgICB1cmwgPSBbaV07XG4gIH1cblxuICBsaXN0ZW5lci5zZXRIYXNoKHVybC5qb2luKCcvJykpO1xuICByZXR1cm4gdXJsO1xufTtcblxuLy9cbi8vICMjIyBmdW5jdGlvbiBpbnNlcnRFeChtZXRob2QsIHBhdGgsIHJvdXRlLCBwYXJlbnQpXG4vLyAjIyMjIEBtZXRob2Qge3N0cmluZ30gTWV0aG9kIHRvIGluc2VydCB0aGUgc3BlY2lmaWMgYHJvdXRlYC5cbi8vICMjIyMgQHBhdGgge0FycmF5fSBQYXJzZWQgcGF0aCB0byBpbnNlcnQgdGhlIGByb3V0ZWAgYXQuXG4vLyAjIyMjIEByb3V0ZSB7QXJyYXl8ZnVuY3Rpb259IFJvdXRlIGhhbmRsZXJzIHRvIGluc2VydC5cbi8vICMjIyMgQHBhcmVudCB7T2JqZWN0fSAqKk9wdGlvbmFsKiogUGFyZW50IFwicm91dGVzXCIgdG8gaW5zZXJ0IGludG8uXG4vLyBpbnNlcnQgYSBjYWxsYmFjayB0aGF0IHdpbGwgb25seSBvY2N1ciBvbmNlIHBlciB0aGUgbWF0Y2hlZCByb3V0ZS5cbi8vXG5Sb3V0ZXIucHJvdG90eXBlLmluc2VydEV4ID0gZnVuY3Rpb24obWV0aG9kLCBwYXRoLCByb3V0ZSwgcGFyZW50KSB7XG4gIGlmIChtZXRob2QgPT09IFwib25jZVwiKSB7XG4gICAgbWV0aG9kID0gXCJvblwiO1xuICAgIHJvdXRlID0gZnVuY3Rpb24ocm91dGUpIHtcbiAgICAgIHZhciBvbmNlID0gZmFsc2U7XG4gICAgICByZXR1cm4gZnVuY3Rpb24oKSB7XG4gICAgICAgIGlmIChvbmNlKSByZXR1cm47XG4gICAgICAgIG9uY2UgPSB0cnVlO1xuICAgICAgICByZXR1cm4gcm91dGUuYXBwbHkodGhpcywgYXJndW1lbnRzKTtcbiAgICAgIH07XG4gICAgfShyb3V0ZSk7XG4gIH1cbiAgcmV0dXJuIHRoaXMuX2luc2VydChtZXRob2QsIHBhdGgsIHJvdXRlLCBwYXJlbnQpO1xufTtcblxuUm91dGVyLnByb3RvdHlwZS5nZXRSb3V0ZSA9IGZ1bmN0aW9uICh2KSB7XG4gIHZhciByZXQgPSB2O1xuXG4gIGlmICh0eXBlb2YgdiA9PT0gXCJudW1iZXJcIikge1xuICAgIHJldCA9IHRoaXMuZXhwbG9kZSgpW3ZdO1xuICB9XG4gIGVsc2UgaWYgKHR5cGVvZiB2ID09PSBcInN0cmluZ1wiKXtcbiAgICB2YXIgaCA9IHRoaXMuZXhwbG9kZSgpO1xuICAgIHJldCA9IGguaW5kZXhPZih2KTtcbiAgfVxuICBlbHNlIHtcbiAgICByZXQgPSB0aGlzLmV4cGxvZGUoKTtcbiAgfVxuXG4gIHJldHVybiByZXQ7XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLmRlc3Ryb3kgPSBmdW5jdGlvbiAoKSB7XG4gIGxpc3RlbmVyLmRlc3Ryb3kodGhpcy5oYW5kbGVyKTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLmdldFBhdGggPSBmdW5jdGlvbiAoKSB7XG4gIHZhciBwYXRoID0gd2luZG93LmxvY2F0aW9uLnBhdGhuYW1lO1xuICBpZiAocGF0aC5zdWJzdHIoMCwgMSkgIT09ICcvJykge1xuICAgIHBhdGggPSAnLycgKyBwYXRoO1xuICB9XG4gIHJldHVybiBwYXRoO1xufTtcbmZ1bmN0aW9uIF9ldmVyeShhcnIsIGl0ZXJhdG9yKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgYXJyLmxlbmd0aDsgaSArPSAxKSB7XG4gICAgaWYgKGl0ZXJhdG9yKGFycltpXSwgaSwgYXJyKSA9PT0gZmFsc2UpIHtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gIH1cbn1cblxuZnVuY3Rpb24gX2ZsYXR0ZW4oYXJyKSB7XG4gIHZhciBmbGF0ID0gW107XG4gIGZvciAodmFyIGkgPSAwLCBuID0gYXJyLmxlbmd0aDsgaSA8IG47IGkrKykge1xuICAgIGZsYXQgPSBmbGF0LmNvbmNhdChhcnJbaV0pO1xuICB9XG4gIHJldHVybiBmbGF0O1xufVxuXG5mdW5jdGlvbiBfYXN5bmNFdmVyeVNlcmllcyhhcnIsIGl0ZXJhdG9yLCBjYWxsYmFjaykge1xuICBpZiAoIWFyci5sZW5ndGgpIHtcbiAgICByZXR1cm4gY2FsbGJhY2soKTtcbiAgfVxuICB2YXIgY29tcGxldGVkID0gMDtcbiAgKGZ1bmN0aW9uIGl0ZXJhdGUoKSB7XG4gICAgaXRlcmF0b3IoYXJyW2NvbXBsZXRlZF0sIGZ1bmN0aW9uKGVycikge1xuICAgICAgaWYgKGVyciB8fCBlcnIgPT09IGZhbHNlKSB7XG4gICAgICAgIGNhbGxiYWNrKGVycik7XG4gICAgICAgIGNhbGxiYWNrID0gZnVuY3Rpb24oKSB7fTtcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGNvbXBsZXRlZCArPSAxO1xuICAgICAgICBpZiAoY29tcGxldGVkID09PSBhcnIubGVuZ3RoKSB7XG4gICAgICAgICAgY2FsbGJhY2soKTtcbiAgICAgICAgfSBlbHNlIHtcbiAgICAgICAgICBpdGVyYXRlKCk7XG4gICAgICAgIH1cbiAgICAgIH1cbiAgICB9KTtcbiAgfSkoKTtcbn1cblxuZnVuY3Rpb24gcGFyYW1pZnlTdHJpbmcoc3RyLCBwYXJhbXMsIG1vZCkge1xuICBtb2QgPSBzdHI7XG4gIGZvciAodmFyIHBhcmFtIGluIHBhcmFtcykge1xuICAgIGlmIChwYXJhbXMuaGFzT3duUHJvcGVydHkocGFyYW0pKSB7XG4gICAgICBtb2QgPSBwYXJhbXNbcGFyYW1dKHN0cik7XG4gICAgICBpZiAobW9kICE9PSBzdHIpIHtcbiAgICAgICAgYnJlYWs7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBtb2QgPT09IHN0ciA/IFwiKFsuX2EtekEtWjAtOS0lKCldKylcIiA6IG1vZDtcbn1cblxuZnVuY3Rpb24gcmVnaWZ5U3RyaW5nKHN0ciwgcGFyYW1zKSB7XG4gIHZhciBtYXRjaGVzLCBsYXN0ID0gMCwgb3V0ID0gXCJcIjtcbiAgd2hpbGUgKG1hdGNoZXMgPSBzdHIuc3Vic3RyKGxhc3QpLm1hdGNoKC9bXlxcd1xcZFxcLSAlQCZdKlxcKlteXFx3XFxkXFwtICVAJl0qLykpIHtcbiAgICBsYXN0ID0gbWF0Y2hlcy5pbmRleCArIG1hdGNoZXNbMF0ubGVuZ3RoO1xuICAgIG1hdGNoZXNbMF0gPSBtYXRjaGVzWzBdLnJlcGxhY2UoL15cXCovLCBcIihbXy4oKSFcXFxcICVAJmEtekEtWjAtOS1dKylcIik7XG4gICAgb3V0ICs9IHN0ci5zdWJzdHIoMCwgbWF0Y2hlcy5pbmRleCkgKyBtYXRjaGVzWzBdO1xuICB9XG4gIHN0ciA9IG91dCArPSBzdHIuc3Vic3RyKGxhc3QpO1xuICB2YXIgY2FwdHVyZXMgPSBzdHIubWF0Y2goLzooW15cXC9dKykvaWcpLCBjYXB0dXJlLCBsZW5ndGg7XG4gIGlmIChjYXB0dXJlcykge1xuICAgIGxlbmd0aCA9IGNhcHR1cmVzLmxlbmd0aDtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICBjYXB0dXJlID0gY2FwdHVyZXNbaV07XG4gICAgICBpZiAoY2FwdHVyZS5zbGljZSgwLCAyKSA9PT0gXCI6OlwiKSB7XG4gICAgICAgIHN0ciA9IGNhcHR1cmUuc2xpY2UoMSk7XG4gICAgICB9IGVsc2Uge1xuICAgICAgICBzdHIgPSBzdHIucmVwbGFjZShjYXB0dXJlLCBwYXJhbWlmeVN0cmluZyhjYXB0dXJlLCBwYXJhbXMpKTtcbiAgICAgIH1cbiAgICB9XG4gIH1cbiAgcmV0dXJuIHN0cjtcbn1cblxuZnVuY3Rpb24gdGVybWluYXRvcihyb3V0ZXMsIGRlbGltaXRlciwgc3RhcnQsIHN0b3ApIHtcbiAgdmFyIGxhc3QgPSAwLCBsZWZ0ID0gMCwgcmlnaHQgPSAwLCBzdGFydCA9IChzdGFydCB8fCBcIihcIikudG9TdHJpbmcoKSwgc3RvcCA9IChzdG9wIHx8IFwiKVwiKS50b1N0cmluZygpLCBpO1xuICBmb3IgKGkgPSAwOyBpIDwgcm91dGVzLmxlbmd0aDsgaSsrKSB7XG4gICAgdmFyIGNodW5rID0gcm91dGVzW2ldO1xuICAgIGlmIChjaHVuay5pbmRleE9mKHN0YXJ0LCBsYXN0KSA+IGNodW5rLmluZGV4T2Yoc3RvcCwgbGFzdCkgfHwgfmNodW5rLmluZGV4T2Yoc3RhcnQsIGxhc3QpICYmICF+Y2h1bmsuaW5kZXhPZihzdG9wLCBsYXN0KSB8fCAhfmNodW5rLmluZGV4T2Yoc3RhcnQsIGxhc3QpICYmIH5jaHVuay5pbmRleE9mKHN0b3AsIGxhc3QpKSB7XG4gICAgICBsZWZ0ID0gY2h1bmsuaW5kZXhPZihzdGFydCwgbGFzdCk7XG4gICAgICByaWdodCA9IGNodW5rLmluZGV4T2Yoc3RvcCwgbGFzdCk7XG4gICAgICBpZiAofmxlZnQgJiYgIX5yaWdodCB8fCAhfmxlZnQgJiYgfnJpZ2h0KSB7XG4gICAgICAgIHZhciB0bXAgPSByb3V0ZXMuc2xpY2UoMCwgKGkgfHwgMSkgKyAxKS5qb2luKGRlbGltaXRlcik7XG4gICAgICAgIHJvdXRlcyA9IFsgdG1wIF0uY29uY2F0KHJvdXRlcy5zbGljZSgoaSB8fCAxKSArIDEpKTtcbiAgICAgIH1cbiAgICAgIGxhc3QgPSAocmlnaHQgPiBsZWZ0ID8gcmlnaHQgOiBsZWZ0KSArIDE7XG4gICAgICBpID0gMDtcbiAgICB9IGVsc2Uge1xuICAgICAgbGFzdCA9IDA7XG4gICAgfVxuICB9XG4gIHJldHVybiByb3V0ZXM7XG59XG5cbnZhciBRVUVSWV9TRVBBUkFUT1IgPSAvXFw/LiovO1xuXG5Sb3V0ZXIucHJvdG90eXBlLmNvbmZpZ3VyZSA9IGZ1bmN0aW9uKG9wdGlvbnMpIHtcbiAgb3B0aW9ucyA9IG9wdGlvbnMgfHwge307XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgdGhpcy5tZXRob2RzLmxlbmd0aDsgaSsrKSB7XG4gICAgdGhpcy5fbWV0aG9kc1t0aGlzLm1ldGhvZHNbaV1dID0gdHJ1ZTtcbiAgfVxuICB0aGlzLnJlY3Vyc2UgPSBvcHRpb25zLnJlY3Vyc2UgfHwgdGhpcy5yZWN1cnNlIHx8IGZhbHNlO1xuICB0aGlzLmFzeW5jID0gb3B0aW9ucy5hc3luYyB8fCBmYWxzZTtcbiAgdGhpcy5kZWxpbWl0ZXIgPSBvcHRpb25zLmRlbGltaXRlciB8fCBcIi9cIjtcbiAgdGhpcy5zdHJpY3QgPSB0eXBlb2Ygb3B0aW9ucy5zdHJpY3QgPT09IFwidW5kZWZpbmVkXCIgPyB0cnVlIDogb3B0aW9ucy5zdHJpY3Q7XG4gIHRoaXMubm90Zm91bmQgPSBvcHRpb25zLm5vdGZvdW5kO1xuICB0aGlzLnJlc291cmNlID0gb3B0aW9ucy5yZXNvdXJjZTtcbiAgdGhpcy5oaXN0b3J5ID0gb3B0aW9ucy5odG1sNWhpc3RvcnkgJiYgdGhpcy5oaXN0b3J5U3VwcG9ydCB8fCBmYWxzZTtcbiAgdGhpcy5ydW5faW5faW5pdCA9IHRoaXMuaGlzdG9yeSA9PT0gdHJ1ZSAmJiBvcHRpb25zLnJ1bl9oYW5kbGVyX2luX2luaXQgIT09IGZhbHNlO1xuICB0aGlzLmNvbnZlcnRfaGFzaF9pbl9pbml0ID0gdGhpcy5oaXN0b3J5ID09PSB0cnVlICYmIG9wdGlvbnMuY29udmVydF9oYXNoX2luX2luaXQgIT09IGZhbHNlO1xuICB0aGlzLmV2ZXJ5ID0ge1xuICAgIGFmdGVyOiBvcHRpb25zLmFmdGVyIHx8IG51bGwsXG4gICAgYmVmb3JlOiBvcHRpb25zLmJlZm9yZSB8fCBudWxsLFxuICAgIG9uOiBvcHRpb25zLm9uIHx8IG51bGxcbiAgfTtcbiAgcmV0dXJuIHRoaXM7XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLnBhcmFtID0gZnVuY3Rpb24odG9rZW4sIG1hdGNoZXIpIHtcbiAgaWYgKHRva2VuWzBdICE9PSBcIjpcIikge1xuICAgIHRva2VuID0gXCI6XCIgKyB0b2tlbjtcbiAgfVxuICB2YXIgY29tcGlsZWQgPSBuZXcgUmVnRXhwKHRva2VuLCBcImdcIik7XG4gIHRoaXMucGFyYW1zW3Rva2VuXSA9IGZ1bmN0aW9uKHN0cikge1xuICAgIHJldHVybiBzdHIucmVwbGFjZShjb21waWxlZCwgbWF0Y2hlci5zb3VyY2UgfHwgbWF0Y2hlcik7XG4gIH07XG4gIHJldHVybiB0aGlzO1xufTtcblxuUm91dGVyLnByb3RvdHlwZS5vbiA9IFJvdXRlci5wcm90b3R5cGUucm91dGUgPSBmdW5jdGlvbihtZXRob2QsIHBhdGgsIHJvdXRlKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgaWYgKCFyb3V0ZSAmJiB0eXBlb2YgcGF0aCA9PSBcImZ1bmN0aW9uXCIpIHtcbiAgICByb3V0ZSA9IHBhdGg7XG4gICAgcGF0aCA9IG1ldGhvZDtcbiAgICBtZXRob2QgPSBcIm9uXCI7XG4gIH1cbiAgaWYgKEFycmF5LmlzQXJyYXkocGF0aCkpIHtcbiAgICByZXR1cm4gcGF0aC5mb3JFYWNoKGZ1bmN0aW9uKHApIHtcbiAgICAgIHNlbGYub24obWV0aG9kLCBwLCByb3V0ZSk7XG4gICAgfSk7XG4gIH1cbiAgaWYgKHBhdGguc291cmNlKSB7XG4gICAgcGF0aCA9IHBhdGguc291cmNlLnJlcGxhY2UoL1xcXFxcXC8vaWcsIFwiL1wiKTtcbiAgfVxuICBpZiAoQXJyYXkuaXNBcnJheShtZXRob2QpKSB7XG4gICAgcmV0dXJuIG1ldGhvZC5mb3JFYWNoKGZ1bmN0aW9uKG0pIHtcbiAgICAgIHNlbGYub24obS50b0xvd2VyQ2FzZSgpLCBwYXRoLCByb3V0ZSk7XG4gICAgfSk7XG4gIH1cbiAgcGF0aCA9IHBhdGguc3BsaXQobmV3IFJlZ0V4cCh0aGlzLmRlbGltaXRlcikpO1xuICBwYXRoID0gdGVybWluYXRvcihwYXRoLCB0aGlzLmRlbGltaXRlcik7XG4gIHRoaXMuaW5zZXJ0KG1ldGhvZCwgdGhpcy5zY29wZS5jb25jYXQocGF0aCksIHJvdXRlKTtcbn07XG5cblJvdXRlci5wcm90b3R5cGUucGF0aCA9IGZ1bmN0aW9uKHBhdGgsIHJvdXRlc0ZuKSB7XG4gIHZhciBzZWxmID0gdGhpcywgbGVuZ3RoID0gdGhpcy5zY29wZS5sZW5ndGg7XG4gIGlmIChwYXRoLnNvdXJjZSkge1xuICAgIHBhdGggPSBwYXRoLnNvdXJjZS5yZXBsYWNlKC9cXFxcXFwvL2lnLCBcIi9cIik7XG4gIH1cbiAgcGF0aCA9IHBhdGguc3BsaXQobmV3IFJlZ0V4cCh0aGlzLmRlbGltaXRlcikpO1xuICBwYXRoID0gdGVybWluYXRvcihwYXRoLCB0aGlzLmRlbGltaXRlcik7XG4gIHRoaXMuc2NvcGUgPSB0aGlzLnNjb3BlLmNvbmNhdChwYXRoKTtcbiAgcm91dGVzRm4uY2FsbCh0aGlzLCB0aGlzKTtcbiAgdGhpcy5zY29wZS5zcGxpY2UobGVuZ3RoLCBwYXRoLmxlbmd0aCk7XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLmRpc3BhdGNoID0gZnVuY3Rpb24obWV0aG9kLCBwYXRoLCBjYWxsYmFjaykge1xuICB2YXIgc2VsZiA9IHRoaXMsIGZucyA9IHRoaXMudHJhdmVyc2UobWV0aG9kLCBwYXRoLnJlcGxhY2UoUVVFUllfU0VQQVJBVE9SLCBcIlwiKSwgdGhpcy5yb3V0ZXMsIFwiXCIpLCBpbnZva2VkID0gdGhpcy5faW52b2tlZCwgYWZ0ZXI7XG4gIHRoaXMuX2ludm9rZWQgPSB0cnVlO1xuICBpZiAoIWZucyB8fCBmbnMubGVuZ3RoID09PSAwKSB7XG4gICAgdGhpcy5sYXN0ID0gW107XG4gICAgaWYgKHR5cGVvZiB0aGlzLm5vdGZvdW5kID09PSBcImZ1bmN0aW9uXCIpIHtcbiAgICAgIHRoaXMuaW52b2tlKFsgdGhpcy5ub3Rmb3VuZCBdLCB7XG4gICAgICAgIG1ldGhvZDogbWV0aG9kLFxuICAgICAgICBwYXRoOiBwYXRoXG4gICAgICB9LCBjYWxsYmFjayk7XG4gICAgfVxuICAgIHJldHVybiBmYWxzZTtcbiAgfVxuICBpZiAodGhpcy5yZWN1cnNlID09PSBcImZvcndhcmRcIikge1xuICAgIGZucyA9IGZucy5yZXZlcnNlKCk7XG4gIH1cbiAgZnVuY3Rpb24gdXBkYXRlQW5kSW52b2tlKCkge1xuICAgIHNlbGYubGFzdCA9IGZucy5hZnRlcjtcbiAgICBzZWxmLmludm9rZShzZWxmLnJ1bmxpc3QoZm5zKSwgc2VsZiwgY2FsbGJhY2spO1xuICB9XG4gIGFmdGVyID0gdGhpcy5ldmVyeSAmJiB0aGlzLmV2ZXJ5LmFmdGVyID8gWyB0aGlzLmV2ZXJ5LmFmdGVyIF0uY29uY2F0KHRoaXMubGFzdCkgOiBbIHRoaXMubGFzdCBdO1xuICBpZiAoYWZ0ZXIgJiYgYWZ0ZXIubGVuZ3RoID4gMCAmJiBpbnZva2VkKSB7XG4gICAgaWYgKHRoaXMuYXN5bmMpIHtcbiAgICAgIHRoaXMuaW52b2tlKGFmdGVyLCB0aGlzLCB1cGRhdGVBbmRJbnZva2UpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aGlzLmludm9rZShhZnRlciwgdGhpcyk7XG4gICAgICB1cGRhdGVBbmRJbnZva2UoKTtcbiAgICB9XG4gICAgcmV0dXJuIHRydWU7XG4gIH1cbiAgdXBkYXRlQW5kSW52b2tlKCk7XG4gIHJldHVybiB0cnVlO1xufTtcblxuUm91dGVyLnByb3RvdHlwZS5pbnZva2UgPSBmdW5jdGlvbihmbnMsIHRoaXNBcmcsIGNhbGxiYWNrKSB7XG4gIHZhciBzZWxmID0gdGhpcztcbiAgdmFyIGFwcGx5O1xuICBpZiAodGhpcy5hc3luYykge1xuICAgIGFwcGx5ID0gZnVuY3Rpb24oZm4sIG5leHQpIHtcbiAgICAgIGlmIChBcnJheS5pc0FycmF5KGZuKSkge1xuICAgICAgICByZXR1cm4gX2FzeW5jRXZlcnlTZXJpZXMoZm4sIGFwcGx5LCBuZXh0KTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGZuID09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICBmbi5hcHBseSh0aGlzQXJnLCAoZm5zLmNhcHR1cmVzIHx8IFtdKS5jb25jYXQobmV4dCkpO1xuICAgICAgfVxuICAgIH07XG4gICAgX2FzeW5jRXZlcnlTZXJpZXMoZm5zLCBhcHBseSwgZnVuY3Rpb24oKSB7XG4gICAgICBpZiAoY2FsbGJhY2spIHtcbiAgICAgICAgY2FsbGJhY2suYXBwbHkodGhpc0FyZywgYXJndW1lbnRzKTtcbiAgICAgIH1cbiAgICB9KTtcbiAgfSBlbHNlIHtcbiAgICBhcHBseSA9IGZ1bmN0aW9uKGZuKSB7XG4gICAgICBpZiAoQXJyYXkuaXNBcnJheShmbikpIHtcbiAgICAgICAgcmV0dXJuIF9ldmVyeShmbiwgYXBwbHkpO1xuICAgICAgfSBlbHNlIGlmICh0eXBlb2YgZm4gPT09IFwiZnVuY3Rpb25cIikge1xuICAgICAgICByZXR1cm4gZm4uYXBwbHkodGhpc0FyZywgZm5zLmNhcHR1cmVzIHx8IFtdKTtcbiAgICAgIH0gZWxzZSBpZiAodHlwZW9mIGZuID09PSBcInN0cmluZ1wiICYmIHNlbGYucmVzb3VyY2UpIHtcbiAgICAgICAgc2VsZi5yZXNvdXJjZVtmbl0uYXBwbHkodGhpc0FyZywgZm5zLmNhcHR1cmVzIHx8IFtdKTtcbiAgICAgIH1cbiAgICB9O1xuICAgIF9ldmVyeShmbnMsIGFwcGx5KTtcbiAgfVxufTtcblxuUm91dGVyLnByb3RvdHlwZS50cmF2ZXJzZSA9IGZ1bmN0aW9uKG1ldGhvZCwgcGF0aCwgcm91dGVzLCByZWdleHAsIGZpbHRlcikge1xuICB2YXIgZm5zID0gW10sIGN1cnJlbnQsIGV4YWN0LCBtYXRjaCwgbmV4dCwgdGhhdDtcbiAgZnVuY3Rpb24gZmlsdGVyUm91dGVzKHJvdXRlcykge1xuICAgIGlmICghZmlsdGVyKSB7XG4gICAgICByZXR1cm4gcm91dGVzO1xuICAgIH1cbiAgICBmdW5jdGlvbiBkZWVwQ29weShzb3VyY2UpIHtcbiAgICAgIHZhciByZXN1bHQgPSBbXTtcbiAgICAgIGZvciAodmFyIGkgPSAwOyBpIDwgc291cmNlLmxlbmd0aDsgaSsrKSB7XG4gICAgICAgIHJlc3VsdFtpXSA9IEFycmF5LmlzQXJyYXkoc291cmNlW2ldKSA/IGRlZXBDb3B5KHNvdXJjZVtpXSkgOiBzb3VyY2VbaV07XG4gICAgICB9XG4gICAgICByZXR1cm4gcmVzdWx0O1xuICAgIH1cbiAgICBmdW5jdGlvbiBhcHBseUZpbHRlcihmbnMpIHtcbiAgICAgIGZvciAodmFyIGkgPSBmbnMubGVuZ3RoIC0gMTsgaSA+PSAwOyBpLS0pIHtcbiAgICAgICAgaWYgKEFycmF5LmlzQXJyYXkoZm5zW2ldKSkge1xuICAgICAgICAgIGFwcGx5RmlsdGVyKGZuc1tpXSk7XG4gICAgICAgICAgaWYgKGZuc1tpXS5sZW5ndGggPT09IDApIHtcbiAgICAgICAgICAgIGZucy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgfVxuICAgICAgICB9IGVsc2Uge1xuICAgICAgICAgIGlmICghZmlsdGVyKGZuc1tpXSkpIHtcbiAgICAgICAgICAgIGZucy5zcGxpY2UoaSwgMSk7XG4gICAgICAgICAgfVxuICAgICAgICB9XG4gICAgICB9XG4gICAgfVxuICAgIHZhciBuZXdSb3V0ZXMgPSBkZWVwQ29weShyb3V0ZXMpO1xuICAgIG5ld1JvdXRlcy5tYXRjaGVkID0gcm91dGVzLm1hdGNoZWQ7XG4gICAgbmV3Um91dGVzLmNhcHR1cmVzID0gcm91dGVzLmNhcHR1cmVzO1xuICAgIG5ld1JvdXRlcy5hZnRlciA9IHJvdXRlcy5hZnRlci5maWx0ZXIoZmlsdGVyKTtcbiAgICBhcHBseUZpbHRlcihuZXdSb3V0ZXMpO1xuICAgIHJldHVybiBuZXdSb3V0ZXM7XG4gIH1cbiAgaWYgKHBhdGggPT09IHRoaXMuZGVsaW1pdGVyICYmIHJvdXRlc1ttZXRob2RdKSB7XG4gICAgbmV4dCA9IFsgWyByb3V0ZXMuYmVmb3JlLCByb3V0ZXNbbWV0aG9kXSBdLmZpbHRlcihCb29sZWFuKSBdO1xuICAgIG5leHQuYWZ0ZXIgPSBbIHJvdXRlcy5hZnRlciBdLmZpbHRlcihCb29sZWFuKTtcbiAgICBuZXh0Lm1hdGNoZWQgPSB0cnVlO1xuICAgIG5leHQuY2FwdHVyZXMgPSBbXTtcbiAgICByZXR1cm4gZmlsdGVyUm91dGVzKG5leHQpO1xuICB9XG4gIGZvciAodmFyIHIgaW4gcm91dGVzKSB7XG4gICAgaWYgKHJvdXRlcy5oYXNPd25Qcm9wZXJ0eShyKSAmJiAoIXRoaXMuX21ldGhvZHNbcl0gfHwgdGhpcy5fbWV0aG9kc1tyXSAmJiB0eXBlb2Ygcm91dGVzW3JdID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHJvdXRlc1tyXSkpKSB7XG4gICAgICBjdXJyZW50ID0gZXhhY3QgPSByZWdleHAgKyB0aGlzLmRlbGltaXRlciArIHI7XG4gICAgICBpZiAoIXRoaXMuc3RyaWN0KSB7XG4gICAgICAgIGV4YWN0ICs9IFwiW1wiICsgdGhpcy5kZWxpbWl0ZXIgKyBcIl0/XCI7XG4gICAgICB9XG4gICAgICBtYXRjaCA9IHBhdGgubWF0Y2gobmV3IFJlZ0V4cChcIl5cIiArIGV4YWN0KSk7XG4gICAgICBpZiAoIW1hdGNoKSB7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgaWYgKG1hdGNoWzBdICYmIG1hdGNoWzBdID09IHBhdGggJiYgcm91dGVzW3JdW21ldGhvZF0pIHtcbiAgICAgICAgbmV4dCA9IFsgWyByb3V0ZXNbcl0uYmVmb3JlLCByb3V0ZXNbcl1bbWV0aG9kXSBdLmZpbHRlcihCb29sZWFuKSBdO1xuICAgICAgICBuZXh0LmFmdGVyID0gWyByb3V0ZXNbcl0uYWZ0ZXIgXS5maWx0ZXIoQm9vbGVhbik7XG4gICAgICAgIG5leHQubWF0Y2hlZCA9IHRydWU7XG4gICAgICAgIG5leHQuY2FwdHVyZXMgPSBtYXRjaC5zbGljZSgxKTtcbiAgICAgICAgaWYgKHRoaXMucmVjdXJzZSAmJiByb3V0ZXMgPT09IHRoaXMucm91dGVzKSB7XG4gICAgICAgICAgbmV4dC5wdXNoKFsgcm91dGVzLmJlZm9yZSwgcm91dGVzLm9uIF0uZmlsdGVyKEJvb2xlYW4pKTtcbiAgICAgICAgICBuZXh0LmFmdGVyID0gbmV4dC5hZnRlci5jb25jYXQoWyByb3V0ZXMuYWZ0ZXIgXS5maWx0ZXIoQm9vbGVhbikpO1xuICAgICAgICB9XG4gICAgICAgIHJldHVybiBmaWx0ZXJSb3V0ZXMobmV4dCk7XG4gICAgICB9XG4gICAgICBuZXh0ID0gdGhpcy50cmF2ZXJzZShtZXRob2QsIHBhdGgsIHJvdXRlc1tyXSwgY3VycmVudCk7XG4gICAgICBpZiAobmV4dC5tYXRjaGVkKSB7XG4gICAgICAgIGlmIChuZXh0Lmxlbmd0aCA+IDApIHtcbiAgICAgICAgICBmbnMgPSBmbnMuY29uY2F0KG5leHQpO1xuICAgICAgICB9XG4gICAgICAgIGlmICh0aGlzLnJlY3Vyc2UpIHtcbiAgICAgICAgICBmbnMucHVzaChbIHJvdXRlc1tyXS5iZWZvcmUsIHJvdXRlc1tyXS5vbiBdLmZpbHRlcihCb29sZWFuKSk7XG4gICAgICAgICAgbmV4dC5hZnRlciA9IG5leHQuYWZ0ZXIuY29uY2F0KFsgcm91dGVzW3JdLmFmdGVyIF0uZmlsdGVyKEJvb2xlYW4pKTtcbiAgICAgICAgICBpZiAocm91dGVzID09PSB0aGlzLnJvdXRlcykge1xuICAgICAgICAgICAgZm5zLnB1c2goWyByb3V0ZXNbXCJiZWZvcmVcIl0sIHJvdXRlc1tcIm9uXCJdIF0uZmlsdGVyKEJvb2xlYW4pKTtcbiAgICAgICAgICAgIG5leHQuYWZ0ZXIgPSBuZXh0LmFmdGVyLmNvbmNhdChbIHJvdXRlc1tcImFmdGVyXCJdIF0uZmlsdGVyKEJvb2xlYW4pKTtcbiAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgZm5zLm1hdGNoZWQgPSB0cnVlO1xuICAgICAgICBmbnMuY2FwdHVyZXMgPSBuZXh0LmNhcHR1cmVzO1xuICAgICAgICBmbnMuYWZ0ZXIgPSBuZXh0LmFmdGVyO1xuICAgICAgICByZXR1cm4gZmlsdGVyUm91dGVzKGZucyk7XG4gICAgICB9XG4gICAgfVxuICB9XG4gIHJldHVybiBmYWxzZTtcbn07XG5cblJvdXRlci5wcm90b3R5cGUuaW5zZXJ0ID0gZnVuY3Rpb24obWV0aG9kLCBwYXRoLCByb3V0ZSwgcGFyZW50KSB7XG4gIHZhciBtZXRob2RUeXBlLCBwYXJlbnRUeXBlLCBpc0FycmF5LCBuZXN0ZWQsIHBhcnQ7XG4gIHBhdGggPSBwYXRoLmZpbHRlcihmdW5jdGlvbihwKSB7XG4gICAgcmV0dXJuIHAgJiYgcC5sZW5ndGggPiAwO1xuICB9KTtcbiAgcGFyZW50ID0gcGFyZW50IHx8IHRoaXMucm91dGVzO1xuICBwYXJ0ID0gcGF0aC5zaGlmdCgpO1xuICBpZiAoL1xcOnxcXCovLnRlc3QocGFydCkgJiYgIS9cXFxcZHxcXFxcdy8udGVzdChwYXJ0KSkge1xuICAgIHBhcnQgPSByZWdpZnlTdHJpbmcocGFydCwgdGhpcy5wYXJhbXMpO1xuICB9XG4gIGlmIChwYXRoLmxlbmd0aCA+IDApIHtcbiAgICBwYXJlbnRbcGFydF0gPSBwYXJlbnRbcGFydF0gfHwge307XG4gICAgcmV0dXJuIHRoaXMuaW5zZXJ0KG1ldGhvZCwgcGF0aCwgcm91dGUsIHBhcmVudFtwYXJ0XSk7XG4gIH1cbiAgaWYgKCFwYXJ0ICYmICFwYXRoLmxlbmd0aCAmJiBwYXJlbnQgPT09IHRoaXMucm91dGVzKSB7XG4gICAgbWV0aG9kVHlwZSA9IHR5cGVvZiBwYXJlbnRbbWV0aG9kXTtcbiAgICBzd2l0Y2ggKG1ldGhvZFR5cGUpIHtcbiAgICAgY2FzZSBcImZ1bmN0aW9uXCI6XG4gICAgICBwYXJlbnRbbWV0aG9kXSA9IFsgcGFyZW50W21ldGhvZF0sIHJvdXRlIF07XG4gICAgICByZXR1cm47XG4gICAgIGNhc2UgXCJvYmplY3RcIjpcbiAgICAgIHBhcmVudFttZXRob2RdLnB1c2gocm91dGUpO1xuICAgICAgcmV0dXJuO1xuICAgICBjYXNlIFwidW5kZWZpbmVkXCI6XG4gICAgICBwYXJlbnRbbWV0aG9kXSA9IHJvdXRlO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgICByZXR1cm47XG4gIH1cbiAgcGFyZW50VHlwZSA9IHR5cGVvZiBwYXJlbnRbcGFydF07XG4gIGlzQXJyYXkgPSBBcnJheS5pc0FycmF5KHBhcmVudFtwYXJ0XSk7XG4gIGlmIChwYXJlbnRbcGFydF0gJiYgIWlzQXJyYXkgJiYgcGFyZW50VHlwZSA9PSBcIm9iamVjdFwiKSB7XG4gICAgbWV0aG9kVHlwZSA9IHR5cGVvZiBwYXJlbnRbcGFydF1bbWV0aG9kXTtcbiAgICBzd2l0Y2ggKG1ldGhvZFR5cGUpIHtcbiAgICAgY2FzZSBcImZ1bmN0aW9uXCI6XG4gICAgICBwYXJlbnRbcGFydF1bbWV0aG9kXSA9IFsgcGFyZW50W3BhcnRdW21ldGhvZF0sIHJvdXRlIF07XG4gICAgICByZXR1cm47XG4gICAgIGNhc2UgXCJvYmplY3RcIjpcbiAgICAgIHBhcmVudFtwYXJ0XVttZXRob2RdLnB1c2gocm91dGUpO1xuICAgICAgcmV0dXJuO1xuICAgICBjYXNlIFwidW5kZWZpbmVkXCI6XG4gICAgICBwYXJlbnRbcGFydF1bbWV0aG9kXSA9IHJvdXRlO1xuICAgICAgcmV0dXJuO1xuICAgIH1cbiAgfSBlbHNlIGlmIChwYXJlbnRUeXBlID09IFwidW5kZWZpbmVkXCIpIHtcbiAgICBuZXN0ZWQgPSB7fTtcbiAgICBuZXN0ZWRbbWV0aG9kXSA9IHJvdXRlO1xuICAgIHBhcmVudFtwYXJ0XSA9IG5lc3RlZDtcbiAgICByZXR1cm47XG4gIH1cbiAgdGhyb3cgbmV3IEVycm9yKFwiSW52YWxpZCByb3V0ZSBjb250ZXh0OiBcIiArIHBhcmVudFR5cGUpO1xufTtcblxuXG5cblJvdXRlci5wcm90b3R5cGUuZXh0ZW5kID0gZnVuY3Rpb24obWV0aG9kcykge1xuICB2YXIgc2VsZiA9IHRoaXMsIGxlbiA9IG1ldGhvZHMubGVuZ3RoLCBpO1xuICBmdW5jdGlvbiBleHRlbmQobWV0aG9kKSB7XG4gICAgc2VsZi5fbWV0aG9kc1ttZXRob2RdID0gdHJ1ZTtcbiAgICBzZWxmW21ldGhvZF0gPSBmdW5jdGlvbigpIHtcbiAgICAgIHZhciBleHRyYSA9IGFyZ3VtZW50cy5sZW5ndGggPT09IDEgPyBbIG1ldGhvZCwgXCJcIiBdIDogWyBtZXRob2QgXTtcbiAgICAgIHNlbGYub24uYXBwbHkoc2VsZiwgZXh0cmEuY29uY2F0KEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKGFyZ3VtZW50cykpKTtcbiAgICB9O1xuICB9XG4gIGZvciAoaSA9IDA7IGkgPCBsZW47IGkrKykge1xuICAgIGV4dGVuZChtZXRob2RzW2ldKTtcbiAgfVxufTtcblxuUm91dGVyLnByb3RvdHlwZS5ydW5saXN0ID0gZnVuY3Rpb24oZm5zKSB7XG4gIHZhciBydW5saXN0ID0gdGhpcy5ldmVyeSAmJiB0aGlzLmV2ZXJ5LmJlZm9yZSA/IFsgdGhpcy5ldmVyeS5iZWZvcmUgXS5jb25jYXQoX2ZsYXR0ZW4oZm5zKSkgOiBfZmxhdHRlbihmbnMpO1xuICBpZiAodGhpcy5ldmVyeSAmJiB0aGlzLmV2ZXJ5Lm9uKSB7XG4gICAgcnVubGlzdC5wdXNoKHRoaXMuZXZlcnkub24pO1xuICB9XG4gIHJ1bmxpc3QuY2FwdHVyZXMgPSBmbnMuY2FwdHVyZXM7XG4gIHJ1bmxpc3Quc291cmNlID0gZm5zLnNvdXJjZTtcbiAgcmV0dXJuIHJ1bmxpc3Q7XG59O1xuXG5Sb3V0ZXIucHJvdG90eXBlLm1vdW50ID0gZnVuY3Rpb24ocm91dGVzLCBwYXRoKSB7XG4gIGlmICghcm91dGVzIHx8IHR5cGVvZiByb3V0ZXMgIT09IFwib2JqZWN0XCIgfHwgQXJyYXkuaXNBcnJheShyb3V0ZXMpKSB7XG4gICAgcmV0dXJuO1xuICB9XG4gIHZhciBzZWxmID0gdGhpcztcbiAgcGF0aCA9IHBhdGggfHwgW107XG4gIGlmICghQXJyYXkuaXNBcnJheShwYXRoKSkge1xuICAgIHBhdGggPSBwYXRoLnNwbGl0KHNlbGYuZGVsaW1pdGVyKTtcbiAgfVxuICBmdW5jdGlvbiBpbnNlcnRPck1vdW50KHJvdXRlLCBsb2NhbCkge1xuICAgIHZhciByZW5hbWUgPSByb3V0ZSwgcGFydHMgPSByb3V0ZS5zcGxpdChzZWxmLmRlbGltaXRlciksIHJvdXRlVHlwZSA9IHR5cGVvZiByb3V0ZXNbcm91dGVdLCBpc1JvdXRlID0gcGFydHNbMF0gPT09IFwiXCIgfHwgIXNlbGYuX21ldGhvZHNbcGFydHNbMF1dLCBldmVudCA9IGlzUm91dGUgPyBcIm9uXCIgOiByZW5hbWU7XG4gICAgaWYgKGlzUm91dGUpIHtcbiAgICAgIHJlbmFtZSA9IHJlbmFtZS5zbGljZSgocmVuYW1lLm1hdGNoKG5ldyBSZWdFeHAoXCJeXCIgKyBzZWxmLmRlbGltaXRlcikpIHx8IFsgXCJcIiBdKVswXS5sZW5ndGgpO1xuICAgICAgcGFydHMuc2hpZnQoKTtcbiAgICB9XG4gICAgaWYgKGlzUm91dGUgJiYgcm91dGVUeXBlID09PSBcIm9iamVjdFwiICYmICFBcnJheS5pc0FycmF5KHJvdXRlc1tyb3V0ZV0pKSB7XG4gICAgICBsb2NhbCA9IGxvY2FsLmNvbmNhdChwYXJ0cyk7XG4gICAgICBzZWxmLm1vdW50KHJvdXRlc1tyb3V0ZV0sIGxvY2FsKTtcbiAgICAgIHJldHVybjtcbiAgICB9XG4gICAgaWYgKGlzUm91dGUpIHtcbiAgICAgIGxvY2FsID0gbG9jYWwuY29uY2F0KHJlbmFtZS5zcGxpdChzZWxmLmRlbGltaXRlcikpO1xuICAgICAgbG9jYWwgPSB0ZXJtaW5hdG9yKGxvY2FsLCBzZWxmLmRlbGltaXRlcik7XG4gICAgfVxuICAgIHNlbGYuaW5zZXJ0KGV2ZW50LCBsb2NhbCwgcm91dGVzW3JvdXRlXSk7XG4gIH1cbiAgZm9yICh2YXIgcm91dGUgaW4gcm91dGVzKSB7XG4gICAgaWYgKHJvdXRlcy5oYXNPd25Qcm9wZXJ0eShyb3V0ZSkpIHtcbiAgICAgIGluc2VydE9yTW91bnQocm91dGUsIHBhdGguc2xpY2UoMCkpO1xuICAgIH1cbiAgfVxufTtcblxuXG5cbn0odHlwZW9mIGV4cG9ydHMgPT09IFwib2JqZWN0XCIgPyBleHBvcnRzIDogd2luZG93KSk7IiwiLyoqXG4gKiBDb3B5cmlnaHQgKGMpIDIwMTQtMjAxNSwgRmFjZWJvb2ssIEluYy5cbiAqIEFsbCByaWdodHMgcmVzZXJ2ZWQuXG4gKlxuICogVGhpcyBzb3VyY2UgY29kZSBpcyBsaWNlbnNlZCB1bmRlciB0aGUgQlNELXN0eWxlIGxpY2Vuc2UgZm91bmQgaW4gdGhlXG4gKiBMSUNFTlNFIGZpbGUgaW4gdGhlIHJvb3QgZGlyZWN0b3J5IG9mIHRoaXMgc291cmNlIHRyZWUuIEFuIGFkZGl0aW9uYWwgZ3JhbnRcbiAqIG9mIHBhdGVudCByaWdodHMgY2FuIGJlIGZvdW5kIGluIHRoZSBQQVRFTlRTIGZpbGUgaW4gdGhlIHNhbWUgZGlyZWN0b3J5LlxuICovXG5cbm1vZHVsZS5leHBvcnRzLkRpc3BhdGNoZXIgPSByZXF1aXJlKCcuL2xpYi9EaXNwYXRjaGVyJyk7XG4iLCIvKipcbiAqIENvcHlyaWdodCAoYykgMjAxNC0yMDE1LCBGYWNlYm9vaywgSW5jLlxuICogQWxsIHJpZ2h0cyByZXNlcnZlZC5cbiAqXG4gKiBUaGlzIHNvdXJjZSBjb2RlIGlzIGxpY2Vuc2VkIHVuZGVyIHRoZSBCU0Qtc3R5bGUgbGljZW5zZSBmb3VuZCBpbiB0aGVcbiAqIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBkaXJlY3Rvcnkgb2YgdGhpcyBzb3VyY2UgdHJlZS4gQW4gYWRkaXRpb25hbCBncmFudFxuICogb2YgcGF0ZW50IHJpZ2h0cyBjYW4gYmUgZm91bmQgaW4gdGhlIFBBVEVOVFMgZmlsZSBpbiB0aGUgc2FtZSBkaXJlY3RvcnkuXG4gKlxuICogQHByb3ZpZGVzTW9kdWxlIERpc3BhdGNoZXJcbiAqIFxuICogQHByZXZlbnRNdW5nZVxuICovXG5cbid1c2Ugc3RyaWN0JztcblxuZXhwb3J0cy5fX2VzTW9kdWxlID0gdHJ1ZTtcblxuZnVuY3Rpb24gX2NsYXNzQ2FsbENoZWNrKGluc3RhbmNlLCBDb25zdHJ1Y3RvcikgeyBpZiAoIShpbnN0YW5jZSBpbnN0YW5jZW9mIENvbnN0cnVjdG9yKSkgeyB0aHJvdyBuZXcgVHlwZUVycm9yKCdDYW5ub3QgY2FsbCBhIGNsYXNzIGFzIGEgZnVuY3Rpb24nKTsgfSB9XG5cbnZhciBpbnZhcmlhbnQgPSByZXF1aXJlKCdmYmpzL2xpYi9pbnZhcmlhbnQnKTtcblxudmFyIF9wcmVmaXggPSAnSURfJztcblxuLyoqXG4gKiBEaXNwYXRjaGVyIGlzIHVzZWQgdG8gYnJvYWRjYXN0IHBheWxvYWRzIHRvIHJlZ2lzdGVyZWQgY2FsbGJhY2tzLiBUaGlzIGlzXG4gKiBkaWZmZXJlbnQgZnJvbSBnZW5lcmljIHB1Yi1zdWIgc3lzdGVtcyBpbiB0d28gd2F5czpcbiAqXG4gKiAgIDEpIENhbGxiYWNrcyBhcmUgbm90IHN1YnNjcmliZWQgdG8gcGFydGljdWxhciBldmVudHMuIEV2ZXJ5IHBheWxvYWQgaXNcbiAqICAgICAgZGlzcGF0Y2hlZCB0byBldmVyeSByZWdpc3RlcmVkIGNhbGxiYWNrLlxuICogICAyKSBDYWxsYmFja3MgY2FuIGJlIGRlZmVycmVkIGluIHdob2xlIG9yIHBhcnQgdW50aWwgb3RoZXIgY2FsbGJhY2tzIGhhdmVcbiAqICAgICAgYmVlbiBleGVjdXRlZC5cbiAqXG4gKiBGb3IgZXhhbXBsZSwgY29uc2lkZXIgdGhpcyBoeXBvdGhldGljYWwgZmxpZ2h0IGRlc3RpbmF0aW9uIGZvcm0sIHdoaWNoXG4gKiBzZWxlY3RzIGEgZGVmYXVsdCBjaXR5IHdoZW4gYSBjb3VudHJ5IGlzIHNlbGVjdGVkOlxuICpcbiAqICAgdmFyIGZsaWdodERpc3BhdGNoZXIgPSBuZXcgRGlzcGF0Y2hlcigpO1xuICpcbiAqICAgLy8gS2VlcHMgdHJhY2sgb2Ygd2hpY2ggY291bnRyeSBpcyBzZWxlY3RlZFxuICogICB2YXIgQ291bnRyeVN0b3JlID0ge2NvdW50cnk6IG51bGx9O1xuICpcbiAqICAgLy8gS2VlcHMgdHJhY2sgb2Ygd2hpY2ggY2l0eSBpcyBzZWxlY3RlZFxuICogICB2YXIgQ2l0eVN0b3JlID0ge2NpdHk6IG51bGx9O1xuICpcbiAqICAgLy8gS2VlcHMgdHJhY2sgb2YgdGhlIGJhc2UgZmxpZ2h0IHByaWNlIG9mIHRoZSBzZWxlY3RlZCBjaXR5XG4gKiAgIHZhciBGbGlnaHRQcmljZVN0b3JlID0ge3ByaWNlOiBudWxsfVxuICpcbiAqIFdoZW4gYSB1c2VyIGNoYW5nZXMgdGhlIHNlbGVjdGVkIGNpdHksIHdlIGRpc3BhdGNoIHRoZSBwYXlsb2FkOlxuICpcbiAqICAgZmxpZ2h0RGlzcGF0Y2hlci5kaXNwYXRjaCh7XG4gKiAgICAgYWN0aW9uVHlwZTogJ2NpdHktdXBkYXRlJyxcbiAqICAgICBzZWxlY3RlZENpdHk6ICdwYXJpcydcbiAqICAgfSk7XG4gKlxuICogVGhpcyBwYXlsb2FkIGlzIGRpZ2VzdGVkIGJ5IGBDaXR5U3RvcmVgOlxuICpcbiAqICAgZmxpZ2h0RGlzcGF0Y2hlci5yZWdpc3RlcihmdW5jdGlvbihwYXlsb2FkKSB7XG4gKiAgICAgaWYgKHBheWxvYWQuYWN0aW9uVHlwZSA9PT0gJ2NpdHktdXBkYXRlJykge1xuICogICAgICAgQ2l0eVN0b3JlLmNpdHkgPSBwYXlsb2FkLnNlbGVjdGVkQ2l0eTtcbiAqICAgICB9XG4gKiAgIH0pO1xuICpcbiAqIFdoZW4gdGhlIHVzZXIgc2VsZWN0cyBhIGNvdW50cnksIHdlIGRpc3BhdGNoIHRoZSBwYXlsb2FkOlxuICpcbiAqICAgZmxpZ2h0RGlzcGF0Y2hlci5kaXNwYXRjaCh7XG4gKiAgICAgYWN0aW9uVHlwZTogJ2NvdW50cnktdXBkYXRlJyxcbiAqICAgICBzZWxlY3RlZENvdW50cnk6ICdhdXN0cmFsaWEnXG4gKiAgIH0pO1xuICpcbiAqIFRoaXMgcGF5bG9hZCBpcyBkaWdlc3RlZCBieSBib3RoIHN0b3JlczpcbiAqXG4gKiAgIENvdW50cnlTdG9yZS5kaXNwYXRjaFRva2VuID0gZmxpZ2h0RGlzcGF0Y2hlci5yZWdpc3RlcihmdW5jdGlvbihwYXlsb2FkKSB7XG4gKiAgICAgaWYgKHBheWxvYWQuYWN0aW9uVHlwZSA9PT0gJ2NvdW50cnktdXBkYXRlJykge1xuICogICAgICAgQ291bnRyeVN0b3JlLmNvdW50cnkgPSBwYXlsb2FkLnNlbGVjdGVkQ291bnRyeTtcbiAqICAgICB9XG4gKiAgIH0pO1xuICpcbiAqIFdoZW4gdGhlIGNhbGxiYWNrIHRvIHVwZGF0ZSBgQ291bnRyeVN0b3JlYCBpcyByZWdpc3RlcmVkLCB3ZSBzYXZlIGEgcmVmZXJlbmNlXG4gKiB0byB0aGUgcmV0dXJuZWQgdG9rZW4uIFVzaW5nIHRoaXMgdG9rZW4gd2l0aCBgd2FpdEZvcigpYCwgd2UgY2FuIGd1YXJhbnRlZVxuICogdGhhdCBgQ291bnRyeVN0b3JlYCBpcyB1cGRhdGVkIGJlZm9yZSB0aGUgY2FsbGJhY2sgdGhhdCB1cGRhdGVzIGBDaXR5U3RvcmVgXG4gKiBuZWVkcyB0byBxdWVyeSBpdHMgZGF0YS5cbiAqXG4gKiAgIENpdHlTdG9yZS5kaXNwYXRjaFRva2VuID0gZmxpZ2h0RGlzcGF0Y2hlci5yZWdpc3RlcihmdW5jdGlvbihwYXlsb2FkKSB7XG4gKiAgICAgaWYgKHBheWxvYWQuYWN0aW9uVHlwZSA9PT0gJ2NvdW50cnktdXBkYXRlJykge1xuICogICAgICAgLy8gYENvdW50cnlTdG9yZS5jb3VudHJ5YCBtYXkgbm90IGJlIHVwZGF0ZWQuXG4gKiAgICAgICBmbGlnaHREaXNwYXRjaGVyLndhaXRGb3IoW0NvdW50cnlTdG9yZS5kaXNwYXRjaFRva2VuXSk7XG4gKiAgICAgICAvLyBgQ291bnRyeVN0b3JlLmNvdW50cnlgIGlzIG5vdyBndWFyYW50ZWVkIHRvIGJlIHVwZGF0ZWQuXG4gKlxuICogICAgICAgLy8gU2VsZWN0IHRoZSBkZWZhdWx0IGNpdHkgZm9yIHRoZSBuZXcgY291bnRyeVxuICogICAgICAgQ2l0eVN0b3JlLmNpdHkgPSBnZXREZWZhdWx0Q2l0eUZvckNvdW50cnkoQ291bnRyeVN0b3JlLmNvdW50cnkpO1xuICogICAgIH1cbiAqICAgfSk7XG4gKlxuICogVGhlIHVzYWdlIG9mIGB3YWl0Rm9yKClgIGNhbiBiZSBjaGFpbmVkLCBmb3IgZXhhbXBsZTpcbiAqXG4gKiAgIEZsaWdodFByaWNlU3RvcmUuZGlzcGF0Y2hUb2tlbiA9XG4gKiAgICAgZmxpZ2h0RGlzcGF0Y2hlci5yZWdpc3RlcihmdW5jdGlvbihwYXlsb2FkKSB7XG4gKiAgICAgICBzd2l0Y2ggKHBheWxvYWQuYWN0aW9uVHlwZSkge1xuICogICAgICAgICBjYXNlICdjb3VudHJ5LXVwZGF0ZSc6XG4gKiAgICAgICAgIGNhc2UgJ2NpdHktdXBkYXRlJzpcbiAqICAgICAgICAgICBmbGlnaHREaXNwYXRjaGVyLndhaXRGb3IoW0NpdHlTdG9yZS5kaXNwYXRjaFRva2VuXSk7XG4gKiAgICAgICAgICAgRmxpZ2h0UHJpY2VTdG9yZS5wcmljZSA9XG4gKiAgICAgICAgICAgICBnZXRGbGlnaHRQcmljZVN0b3JlKENvdW50cnlTdG9yZS5jb3VudHJ5LCBDaXR5U3RvcmUuY2l0eSk7XG4gKiAgICAgICAgICAgYnJlYWs7XG4gKiAgICAgfVxuICogICB9KTtcbiAqXG4gKiBUaGUgYGNvdW50cnktdXBkYXRlYCBwYXlsb2FkIHdpbGwgYmUgZ3VhcmFudGVlZCB0byBpbnZva2UgdGhlIHN0b3JlcydcbiAqIHJlZ2lzdGVyZWQgY2FsbGJhY2tzIGluIG9yZGVyOiBgQ291bnRyeVN0b3JlYCwgYENpdHlTdG9yZWAsIHRoZW5cbiAqIGBGbGlnaHRQcmljZVN0b3JlYC5cbiAqL1xuXG52YXIgRGlzcGF0Y2hlciA9IChmdW5jdGlvbiAoKSB7XG4gIGZ1bmN0aW9uIERpc3BhdGNoZXIoKSB7XG4gICAgX2NsYXNzQ2FsbENoZWNrKHRoaXMsIERpc3BhdGNoZXIpO1xuXG4gICAgdGhpcy5fY2FsbGJhY2tzID0ge307XG4gICAgdGhpcy5faXNEaXNwYXRjaGluZyA9IGZhbHNlO1xuICAgIHRoaXMuX2lzSGFuZGxlZCA9IHt9O1xuICAgIHRoaXMuX2lzUGVuZGluZyA9IHt9O1xuICAgIHRoaXMuX2xhc3RJRCA9IDE7XG4gIH1cblxuICAvKipcbiAgICogUmVnaXN0ZXJzIGEgY2FsbGJhY2sgdG8gYmUgaW52b2tlZCB3aXRoIGV2ZXJ5IGRpc3BhdGNoZWQgcGF5bG9hZC4gUmV0dXJuc1xuICAgKiBhIHRva2VuIHRoYXQgY2FuIGJlIHVzZWQgd2l0aCBgd2FpdEZvcigpYC5cbiAgICovXG5cbiAgRGlzcGF0Y2hlci5wcm90b3R5cGUucmVnaXN0ZXIgPSBmdW5jdGlvbiByZWdpc3RlcihjYWxsYmFjaykge1xuICAgIHZhciBpZCA9IF9wcmVmaXggKyB0aGlzLl9sYXN0SUQrKztcbiAgICB0aGlzLl9jYWxsYmFja3NbaWRdID0gY2FsbGJhY2s7XG4gICAgcmV0dXJuIGlkO1xuICB9O1xuXG4gIC8qKlxuICAgKiBSZW1vdmVzIGEgY2FsbGJhY2sgYmFzZWQgb24gaXRzIHRva2VuLlxuICAgKi9cblxuICBEaXNwYXRjaGVyLnByb3RvdHlwZS51bnJlZ2lzdGVyID0gZnVuY3Rpb24gdW5yZWdpc3RlcihpZCkge1xuICAgICF0aGlzLl9jYWxsYmFja3NbaWRdID8gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJyA/IGludmFyaWFudChmYWxzZSwgJ0Rpc3BhdGNoZXIudW5yZWdpc3RlciguLi4pOiBgJXNgIGRvZXMgbm90IG1hcCB0byBhIHJlZ2lzdGVyZWQgY2FsbGJhY2suJywgaWQpIDogaW52YXJpYW50KGZhbHNlKSA6IHVuZGVmaW5lZDtcbiAgICBkZWxldGUgdGhpcy5fY2FsbGJhY2tzW2lkXTtcbiAgfTtcblxuICAvKipcbiAgICogV2FpdHMgZm9yIHRoZSBjYWxsYmFja3Mgc3BlY2lmaWVkIHRvIGJlIGludm9rZWQgYmVmb3JlIGNvbnRpbnVpbmcgZXhlY3V0aW9uXG4gICAqIG9mIHRoZSBjdXJyZW50IGNhbGxiYWNrLiBUaGlzIG1ldGhvZCBzaG91bGQgb25seSBiZSB1c2VkIGJ5IGEgY2FsbGJhY2sgaW5cbiAgICogcmVzcG9uc2UgdG8gYSBkaXNwYXRjaGVkIHBheWxvYWQuXG4gICAqL1xuXG4gIERpc3BhdGNoZXIucHJvdG90eXBlLndhaXRGb3IgPSBmdW5jdGlvbiB3YWl0Rm9yKGlkcykge1xuICAgICF0aGlzLl9pc0Rpc3BhdGNoaW5nID8gcHJvY2Vzcy5lbnYuTk9ERV9FTlYgIT09ICdwcm9kdWN0aW9uJyA/IGludmFyaWFudChmYWxzZSwgJ0Rpc3BhdGNoZXIud2FpdEZvciguLi4pOiBNdXN0IGJlIGludm9rZWQgd2hpbGUgZGlzcGF0Y2hpbmcuJykgOiBpbnZhcmlhbnQoZmFsc2UpIDogdW5kZWZpbmVkO1xuICAgIGZvciAodmFyIGlpID0gMDsgaWkgPCBpZHMubGVuZ3RoOyBpaSsrKSB7XG4gICAgICB2YXIgaWQgPSBpZHNbaWldO1xuICAgICAgaWYgKHRoaXMuX2lzUGVuZGluZ1tpZF0pIHtcbiAgICAgICAgIXRoaXMuX2lzSGFuZGxlZFtpZF0gPyBwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nID8gaW52YXJpYW50KGZhbHNlLCAnRGlzcGF0Y2hlci53YWl0Rm9yKC4uLik6IENpcmN1bGFyIGRlcGVuZGVuY3kgZGV0ZWN0ZWQgd2hpbGUgJyArICd3YWl0aW5nIGZvciBgJXNgLicsIGlkKSA6IGludmFyaWFudChmYWxzZSkgOiB1bmRlZmluZWQ7XG4gICAgICAgIGNvbnRpbnVlO1xuICAgICAgfVxuICAgICAgIXRoaXMuX2NhbGxiYWNrc1tpZF0gPyBwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nID8gaW52YXJpYW50KGZhbHNlLCAnRGlzcGF0Y2hlci53YWl0Rm9yKC4uLik6IGAlc2AgZG9lcyBub3QgbWFwIHRvIGEgcmVnaXN0ZXJlZCBjYWxsYmFjay4nLCBpZCkgOiBpbnZhcmlhbnQoZmFsc2UpIDogdW5kZWZpbmVkO1xuICAgICAgdGhpcy5faW52b2tlQ2FsbGJhY2soaWQpO1xuICAgIH1cbiAgfTtcblxuICAvKipcbiAgICogRGlzcGF0Y2hlcyBhIHBheWxvYWQgdG8gYWxsIHJlZ2lzdGVyZWQgY2FsbGJhY2tzLlxuICAgKi9cblxuICBEaXNwYXRjaGVyLnByb3RvdHlwZS5kaXNwYXRjaCA9IGZ1bmN0aW9uIGRpc3BhdGNoKHBheWxvYWQpIHtcbiAgICAhIXRoaXMuX2lzRGlzcGF0Y2hpbmcgPyBwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nID8gaW52YXJpYW50KGZhbHNlLCAnRGlzcGF0Y2guZGlzcGF0Y2goLi4uKTogQ2Fubm90IGRpc3BhdGNoIGluIHRoZSBtaWRkbGUgb2YgYSBkaXNwYXRjaC4nKSA6IGludmFyaWFudChmYWxzZSkgOiB1bmRlZmluZWQ7XG4gICAgdGhpcy5fc3RhcnREaXNwYXRjaGluZyhwYXlsb2FkKTtcbiAgICB0cnkge1xuICAgICAgZm9yICh2YXIgaWQgaW4gdGhpcy5fY2FsbGJhY2tzKSB7XG4gICAgICAgIGlmICh0aGlzLl9pc1BlbmRpbmdbaWRdKSB7XG4gICAgICAgICAgY29udGludWU7XG4gICAgICAgIH1cbiAgICAgICAgdGhpcy5faW52b2tlQ2FsbGJhY2soaWQpO1xuICAgICAgfVxuICAgIH0gZmluYWxseSB7XG4gICAgICB0aGlzLl9zdG9wRGlzcGF0Y2hpbmcoKTtcbiAgICB9XG4gIH07XG5cbiAgLyoqXG4gICAqIElzIHRoaXMgRGlzcGF0Y2hlciBjdXJyZW50bHkgZGlzcGF0Y2hpbmcuXG4gICAqL1xuXG4gIERpc3BhdGNoZXIucHJvdG90eXBlLmlzRGlzcGF0Y2hpbmcgPSBmdW5jdGlvbiBpc0Rpc3BhdGNoaW5nKCkge1xuICAgIHJldHVybiB0aGlzLl9pc0Rpc3BhdGNoaW5nO1xuICB9O1xuXG4gIC8qKlxuICAgKiBDYWxsIHRoZSBjYWxsYmFjayBzdG9yZWQgd2l0aCB0aGUgZ2l2ZW4gaWQuIEFsc28gZG8gc29tZSBpbnRlcm5hbFxuICAgKiBib29ra2VlcGluZy5cbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuXG4gIERpc3BhdGNoZXIucHJvdG90eXBlLl9pbnZva2VDYWxsYmFjayA9IGZ1bmN0aW9uIF9pbnZva2VDYWxsYmFjayhpZCkge1xuICAgIHRoaXMuX2lzUGVuZGluZ1tpZF0gPSB0cnVlO1xuICAgIHRoaXMuX2NhbGxiYWNrc1tpZF0odGhpcy5fcGVuZGluZ1BheWxvYWQpO1xuICAgIHRoaXMuX2lzSGFuZGxlZFtpZF0gPSB0cnVlO1xuICB9O1xuXG4gIC8qKlxuICAgKiBTZXQgdXAgYm9va2tlZXBpbmcgbmVlZGVkIHdoZW4gZGlzcGF0Y2hpbmcuXG4gICAqXG4gICAqIEBpbnRlcm5hbFxuICAgKi9cblxuICBEaXNwYXRjaGVyLnByb3RvdHlwZS5fc3RhcnREaXNwYXRjaGluZyA9IGZ1bmN0aW9uIF9zdGFydERpc3BhdGNoaW5nKHBheWxvYWQpIHtcbiAgICBmb3IgKHZhciBpZCBpbiB0aGlzLl9jYWxsYmFja3MpIHtcbiAgICAgIHRoaXMuX2lzUGVuZGluZ1tpZF0gPSBmYWxzZTtcbiAgICAgIHRoaXMuX2lzSGFuZGxlZFtpZF0gPSBmYWxzZTtcbiAgICB9XG4gICAgdGhpcy5fcGVuZGluZ1BheWxvYWQgPSBwYXlsb2FkO1xuICAgIHRoaXMuX2lzRGlzcGF0Y2hpbmcgPSB0cnVlO1xuICB9O1xuXG4gIC8qKlxuICAgKiBDbGVhciBib29ra2VlcGluZyB1c2VkIGZvciBkaXNwYXRjaGluZy5cbiAgICpcbiAgICogQGludGVybmFsXG4gICAqL1xuXG4gIERpc3BhdGNoZXIucHJvdG90eXBlLl9zdG9wRGlzcGF0Y2hpbmcgPSBmdW5jdGlvbiBfc3RvcERpc3BhdGNoaW5nKCkge1xuICAgIGRlbGV0ZSB0aGlzLl9wZW5kaW5nUGF5bG9hZDtcbiAgICB0aGlzLl9pc0Rpc3BhdGNoaW5nID0gZmFsc2U7XG4gIH07XG5cbiAgcmV0dXJuIERpc3BhdGNoZXI7XG59KSgpO1xuXG5tb2R1bGUuZXhwb3J0cyA9IERpc3BhdGNoZXI7IiwiLyoqXG4gKiBDb3B5cmlnaHQgMjAxMy0yMDE1LCBGYWNlYm9vaywgSW5jLlxuICogQWxsIHJpZ2h0cyByZXNlcnZlZC5cbiAqXG4gKiBUaGlzIHNvdXJjZSBjb2RlIGlzIGxpY2Vuc2VkIHVuZGVyIHRoZSBCU0Qtc3R5bGUgbGljZW5zZSBmb3VuZCBpbiB0aGVcbiAqIExJQ0VOU0UgZmlsZSBpbiB0aGUgcm9vdCBkaXJlY3Rvcnkgb2YgdGhpcyBzb3VyY2UgdHJlZS4gQW4gYWRkaXRpb25hbCBncmFudFxuICogb2YgcGF0ZW50IHJpZ2h0cyBjYW4gYmUgZm91bmQgaW4gdGhlIFBBVEVOVFMgZmlsZSBpbiB0aGUgc2FtZSBkaXJlY3RvcnkuXG4gKlxuICogQHByb3ZpZGVzTW9kdWxlIGludmFyaWFudFxuICovXG5cblwidXNlIHN0cmljdFwiO1xuXG4vKipcbiAqIFVzZSBpbnZhcmlhbnQoKSB0byBhc3NlcnQgc3RhdGUgd2hpY2ggeW91ciBwcm9ncmFtIGFzc3VtZXMgdG8gYmUgdHJ1ZS5cbiAqXG4gKiBQcm92aWRlIHNwcmludGYtc3R5bGUgZm9ybWF0IChvbmx5ICVzIGlzIHN1cHBvcnRlZCkgYW5kIGFyZ3VtZW50c1xuICogdG8gcHJvdmlkZSBpbmZvcm1hdGlvbiBhYm91dCB3aGF0IGJyb2tlIGFuZCB3aGF0IHlvdSB3ZXJlXG4gKiBleHBlY3RpbmcuXG4gKlxuICogVGhlIGludmFyaWFudCBtZXNzYWdlIHdpbGwgYmUgc3RyaXBwZWQgaW4gcHJvZHVjdGlvbiwgYnV0IHRoZSBpbnZhcmlhbnRcbiAqIHdpbGwgcmVtYWluIHRvIGVuc3VyZSBsb2dpYyBkb2VzIG5vdCBkaWZmZXIgaW4gcHJvZHVjdGlvbi5cbiAqL1xuXG52YXIgaW52YXJpYW50ID0gZnVuY3Rpb24gKGNvbmRpdGlvbiwgZm9ybWF0LCBhLCBiLCBjLCBkLCBlLCBmKSB7XG4gIGlmIChwcm9jZXNzLmVudi5OT0RFX0VOViAhPT0gJ3Byb2R1Y3Rpb24nKSB7XG4gICAgaWYgKGZvcm1hdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICB0aHJvdyBuZXcgRXJyb3IoJ2ludmFyaWFudCByZXF1aXJlcyBhbiBlcnJvciBtZXNzYWdlIGFyZ3VtZW50Jyk7XG4gICAgfVxuICB9XG5cbiAgaWYgKCFjb25kaXRpb24pIHtcbiAgICB2YXIgZXJyb3I7XG4gICAgaWYgKGZvcm1hdCA9PT0gdW5kZWZpbmVkKSB7XG4gICAgICBlcnJvciA9IG5ldyBFcnJvcignTWluaWZpZWQgZXhjZXB0aW9uIG9jY3VycmVkOyB1c2UgdGhlIG5vbi1taW5pZmllZCBkZXYgZW52aXJvbm1lbnQgJyArICdmb3IgdGhlIGZ1bGwgZXJyb3IgbWVzc2FnZSBhbmQgYWRkaXRpb25hbCBoZWxwZnVsIHdhcm5pbmdzLicpO1xuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYXJncyA9IFthLCBiLCBjLCBkLCBlLCBmXTtcbiAgICAgIHZhciBhcmdJbmRleCA9IDA7XG4gICAgICBlcnJvciA9IG5ldyBFcnJvcignSW52YXJpYW50IFZpb2xhdGlvbjogJyArIGZvcm1hdC5yZXBsYWNlKC8lcy9nLCBmdW5jdGlvbiAoKSB7XG4gICAgICAgIHJldHVybiBhcmdzW2FyZ0luZGV4KytdO1xuICAgICAgfSkpO1xuICAgIH1cblxuICAgIGVycm9yLmZyYW1lc1RvUG9wID0gMTsgLy8gd2UgZG9uJ3QgY2FyZSBhYm91dCBpbnZhcmlhbnQncyBvd24gZnJhbWVcbiAgICB0aHJvdyBlcnJvcjtcbiAgfVxufTtcblxubW9kdWxlLmV4cG9ydHMgPSBpbnZhcmlhbnQ7IiwiLyoqXG4gKiBsb2Rhc2ggMy4xLjEgKEN1c3RvbSBCdWlsZCkgPGh0dHBzOi8vbG9kYXNoLmNvbS8+XG4gKiBCdWlsZDogYGxvZGFzaCBtb2Rlcm4gbW9kdWxhcml6ZSBleHBvcnRzPVwibnBtXCIgLW8gLi9gXG4gKiBDb3B5cmlnaHQgMjAxMi0yMDE1IFRoZSBEb2pvIEZvdW5kYXRpb24gPGh0dHA6Ly9kb2pvZm91bmRhdGlvbi5vcmcvPlxuICogQmFzZWQgb24gVW5kZXJzY29yZS5qcyAxLjguMyA8aHR0cDovL3VuZGVyc2NvcmVqcy5vcmcvTElDRU5TRT5cbiAqIENvcHlyaWdodCAyMDA5LTIwMTUgSmVyZW15IEFzaGtlbmFzLCBEb2N1bWVudENsb3VkIGFuZCBJbnZlc3RpZ2F0aXZlIFJlcG9ydGVycyAmIEVkaXRvcnNcbiAqIEF2YWlsYWJsZSB1bmRlciBNSVQgbGljZW5zZSA8aHR0cHM6Ly9sb2Rhc2guY29tL2xpY2Vuc2U+XG4gKi9cbnZhciBnZXROYXRpdmUgPSByZXF1aXJlKCdsb2Rhc2guX2dldG5hdGl2ZScpO1xuXG4vKiogVXNlZCBhcyB0aGUgYFR5cGVFcnJvcmAgbWVzc2FnZSBmb3IgXCJGdW5jdGlvbnNcIiBtZXRob2RzLiAqL1xudmFyIEZVTkNfRVJST1JfVEVYVCA9ICdFeHBlY3RlZCBhIGZ1bmN0aW9uJztcblxuLyogTmF0aXZlIG1ldGhvZCByZWZlcmVuY2VzIGZvciB0aG9zZSB3aXRoIHRoZSBzYW1lIG5hbWUgYXMgb3RoZXIgYGxvZGFzaGAgbWV0aG9kcy4gKi9cbnZhciBuYXRpdmVNYXggPSBNYXRoLm1heCxcbiAgICBuYXRpdmVOb3cgPSBnZXROYXRpdmUoRGF0ZSwgJ25vdycpO1xuXG4vKipcbiAqIEdldHMgdGhlIG51bWJlciBvZiBtaWxsaXNlY29uZHMgdGhhdCBoYXZlIGVsYXBzZWQgc2luY2UgdGhlIFVuaXggZXBvY2hcbiAqICgxIEphbnVhcnkgMTk3MCAwMDowMDowMCBVVEMpLlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAY2F0ZWdvcnkgRGF0ZVxuICogQGV4YW1wbGVcbiAqXG4gKiBfLmRlZmVyKGZ1bmN0aW9uKHN0YW1wKSB7XG4gKiAgIGNvbnNvbGUubG9nKF8ubm93KCkgLSBzdGFtcCk7XG4gKiB9LCBfLm5vdygpKTtcbiAqIC8vID0+IGxvZ3MgdGhlIG51bWJlciBvZiBtaWxsaXNlY29uZHMgaXQgdG9vayBmb3IgdGhlIGRlZmVycmVkIGZ1bmN0aW9uIHRvIGJlIGludm9rZWRcbiAqL1xudmFyIG5vdyA9IG5hdGl2ZU5vdyB8fCBmdW5jdGlvbigpIHtcbiAgcmV0dXJuIG5ldyBEYXRlKCkuZ2V0VGltZSgpO1xufTtcblxuLyoqXG4gKiBDcmVhdGVzIGEgZGVib3VuY2VkIGZ1bmN0aW9uIHRoYXQgZGVsYXlzIGludm9raW5nIGBmdW5jYCB1bnRpbCBhZnRlciBgd2FpdGBcbiAqIG1pbGxpc2Vjb25kcyBoYXZlIGVsYXBzZWQgc2luY2UgdGhlIGxhc3QgdGltZSB0aGUgZGVib3VuY2VkIGZ1bmN0aW9uIHdhc1xuICogaW52b2tlZC4gVGhlIGRlYm91bmNlZCBmdW5jdGlvbiBjb21lcyB3aXRoIGEgYGNhbmNlbGAgbWV0aG9kIHRvIGNhbmNlbFxuICogZGVsYXllZCBpbnZvY2F0aW9ucy4gUHJvdmlkZSBhbiBvcHRpb25zIG9iamVjdCB0byBpbmRpY2F0ZSB0aGF0IGBmdW5jYFxuICogc2hvdWxkIGJlIGludm9rZWQgb24gdGhlIGxlYWRpbmcgYW5kL29yIHRyYWlsaW5nIGVkZ2Ugb2YgdGhlIGB3YWl0YCB0aW1lb3V0LlxuICogU3Vic2VxdWVudCBjYWxscyB0byB0aGUgZGVib3VuY2VkIGZ1bmN0aW9uIHJldHVybiB0aGUgcmVzdWx0IG9mIHRoZSBsYXN0XG4gKiBgZnVuY2AgaW52b2NhdGlvbi5cbiAqXG4gKiAqKk5vdGU6KiogSWYgYGxlYWRpbmdgIGFuZCBgdHJhaWxpbmdgIG9wdGlvbnMgYXJlIGB0cnVlYCwgYGZ1bmNgIGlzIGludm9rZWRcbiAqIG9uIHRoZSB0cmFpbGluZyBlZGdlIG9mIHRoZSB0aW1lb3V0IG9ubHkgaWYgdGhlIHRoZSBkZWJvdW5jZWQgZnVuY3Rpb24gaXNcbiAqIGludm9rZWQgbW9yZSB0aGFuIG9uY2UgZHVyaW5nIHRoZSBgd2FpdGAgdGltZW91dC5cbiAqXG4gKiBTZWUgW0RhdmlkIENvcmJhY2hvJ3MgYXJ0aWNsZV0oaHR0cDovL2RydXBhbG1vdGlvbi5jb20vYXJ0aWNsZS9kZWJvdW5jZS1hbmQtdGhyb3R0bGUtdmlzdWFsLWV4cGxhbmF0aW9uKVxuICogZm9yIGRldGFpbHMgb3ZlciB0aGUgZGlmZmVyZW5jZXMgYmV0d2VlbiBgXy5kZWJvdW5jZWAgYW5kIGBfLnRocm90dGxlYC5cbiAqXG4gKiBAc3RhdGljXG4gKiBAbWVtYmVyT2YgX1xuICogQGNhdGVnb3J5IEZ1bmN0aW9uXG4gKiBAcGFyYW0ge0Z1bmN0aW9ufSBmdW5jIFRoZSBmdW5jdGlvbiB0byBkZWJvdW5jZS5cbiAqIEBwYXJhbSB7bnVtYmVyfSBbd2FpdD0wXSBUaGUgbnVtYmVyIG9mIG1pbGxpc2Vjb25kcyB0byBkZWxheS5cbiAqIEBwYXJhbSB7T2JqZWN0fSBbb3B0aW9uc10gVGhlIG9wdGlvbnMgb2JqZWN0LlxuICogQHBhcmFtIHtib29sZWFufSBbb3B0aW9ucy5sZWFkaW5nPWZhbHNlXSBTcGVjaWZ5IGludm9raW5nIG9uIHRoZSBsZWFkaW5nXG4gKiAgZWRnZSBvZiB0aGUgdGltZW91dC5cbiAqIEBwYXJhbSB7bnVtYmVyfSBbb3B0aW9ucy5tYXhXYWl0XSBUaGUgbWF4aW11bSB0aW1lIGBmdW5jYCBpcyBhbGxvd2VkIHRvIGJlXG4gKiAgZGVsYXllZCBiZWZvcmUgaXQgaXMgaW52b2tlZC5cbiAqIEBwYXJhbSB7Ym9vbGVhbn0gW29wdGlvbnMudHJhaWxpbmc9dHJ1ZV0gU3BlY2lmeSBpbnZva2luZyBvbiB0aGUgdHJhaWxpbmdcbiAqICBlZGdlIG9mIHRoZSB0aW1lb3V0LlxuICogQHJldHVybnMge0Z1bmN0aW9ufSBSZXR1cm5zIHRoZSBuZXcgZGVib3VuY2VkIGZ1bmN0aW9uLlxuICogQGV4YW1wbGVcbiAqXG4gKiAvLyBhdm9pZCBjb3N0bHkgY2FsY3VsYXRpb25zIHdoaWxlIHRoZSB3aW5kb3cgc2l6ZSBpcyBpbiBmbHV4XG4gKiBqUXVlcnkod2luZG93KS5vbigncmVzaXplJywgXy5kZWJvdW5jZShjYWxjdWxhdGVMYXlvdXQsIDE1MCkpO1xuICpcbiAqIC8vIGludm9rZSBgc2VuZE1haWxgIHdoZW4gdGhlIGNsaWNrIGV2ZW50IGlzIGZpcmVkLCBkZWJvdW5jaW5nIHN1YnNlcXVlbnQgY2FsbHNcbiAqIGpRdWVyeSgnI3Bvc3Rib3gnKS5vbignY2xpY2snLCBfLmRlYm91bmNlKHNlbmRNYWlsLCAzMDAsIHtcbiAqICAgJ2xlYWRpbmcnOiB0cnVlLFxuICogICAndHJhaWxpbmcnOiBmYWxzZVxuICogfSkpO1xuICpcbiAqIC8vIGVuc3VyZSBgYmF0Y2hMb2dgIGlzIGludm9rZWQgb25jZSBhZnRlciAxIHNlY29uZCBvZiBkZWJvdW5jZWQgY2FsbHNcbiAqIHZhciBzb3VyY2UgPSBuZXcgRXZlbnRTb3VyY2UoJy9zdHJlYW0nKTtcbiAqIGpRdWVyeShzb3VyY2UpLm9uKCdtZXNzYWdlJywgXy5kZWJvdW5jZShiYXRjaExvZywgMjUwLCB7XG4gKiAgICdtYXhXYWl0JzogMTAwMFxuICogfSkpO1xuICpcbiAqIC8vIGNhbmNlbCBhIGRlYm91bmNlZCBjYWxsXG4gKiB2YXIgdG9kb0NoYW5nZXMgPSBfLmRlYm91bmNlKGJhdGNoTG9nLCAxMDAwKTtcbiAqIE9iamVjdC5vYnNlcnZlKG1vZGVscy50b2RvLCB0b2RvQ2hhbmdlcyk7XG4gKlxuICogT2JqZWN0Lm9ic2VydmUobW9kZWxzLCBmdW5jdGlvbihjaGFuZ2VzKSB7XG4gKiAgIGlmIChfLmZpbmQoY2hhbmdlcywgeyAndXNlcic6ICd0b2RvJywgJ3R5cGUnOiAnZGVsZXRlJ30pKSB7XG4gKiAgICAgdG9kb0NoYW5nZXMuY2FuY2VsKCk7XG4gKiAgIH1cbiAqIH0sIFsnZGVsZXRlJ10pO1xuICpcbiAqIC8vIC4uLmF0IHNvbWUgcG9pbnQgYG1vZGVscy50b2RvYCBpcyBjaGFuZ2VkXG4gKiBtb2RlbHMudG9kby5jb21wbGV0ZWQgPSB0cnVlO1xuICpcbiAqIC8vIC4uLmJlZm9yZSAxIHNlY29uZCBoYXMgcGFzc2VkIGBtb2RlbHMudG9kb2AgaXMgZGVsZXRlZFxuICogLy8gd2hpY2ggY2FuY2VscyB0aGUgZGVib3VuY2VkIGB0b2RvQ2hhbmdlc2AgY2FsbFxuICogZGVsZXRlIG1vZGVscy50b2RvO1xuICovXG5mdW5jdGlvbiBkZWJvdW5jZShmdW5jLCB3YWl0LCBvcHRpb25zKSB7XG4gIHZhciBhcmdzLFxuICAgICAgbWF4VGltZW91dElkLFxuICAgICAgcmVzdWx0LFxuICAgICAgc3RhbXAsXG4gICAgICB0aGlzQXJnLFxuICAgICAgdGltZW91dElkLFxuICAgICAgdHJhaWxpbmdDYWxsLFxuICAgICAgbGFzdENhbGxlZCA9IDAsXG4gICAgICBtYXhXYWl0ID0gZmFsc2UsXG4gICAgICB0cmFpbGluZyA9IHRydWU7XG5cbiAgaWYgKHR5cGVvZiBmdW5jICE9ICdmdW5jdGlvbicpIHtcbiAgICB0aHJvdyBuZXcgVHlwZUVycm9yKEZVTkNfRVJST1JfVEVYVCk7XG4gIH1cbiAgd2FpdCA9IHdhaXQgPCAwID8gMCA6ICgrd2FpdCB8fCAwKTtcbiAgaWYgKG9wdGlvbnMgPT09IHRydWUpIHtcbiAgICB2YXIgbGVhZGluZyA9IHRydWU7XG4gICAgdHJhaWxpbmcgPSBmYWxzZTtcbiAgfSBlbHNlIGlmIChpc09iamVjdChvcHRpb25zKSkge1xuICAgIGxlYWRpbmcgPSAhIW9wdGlvbnMubGVhZGluZztcbiAgICBtYXhXYWl0ID0gJ21heFdhaXQnIGluIG9wdGlvbnMgJiYgbmF0aXZlTWF4KCtvcHRpb25zLm1heFdhaXQgfHwgMCwgd2FpdCk7XG4gICAgdHJhaWxpbmcgPSAndHJhaWxpbmcnIGluIG9wdGlvbnMgPyAhIW9wdGlvbnMudHJhaWxpbmcgOiB0cmFpbGluZztcbiAgfVxuXG4gIGZ1bmN0aW9uIGNhbmNlbCgpIHtcbiAgICBpZiAodGltZW91dElkKSB7XG4gICAgICBjbGVhclRpbWVvdXQodGltZW91dElkKTtcbiAgICB9XG4gICAgaWYgKG1heFRpbWVvdXRJZCkge1xuICAgICAgY2xlYXJUaW1lb3V0KG1heFRpbWVvdXRJZCk7XG4gICAgfVxuICAgIGxhc3RDYWxsZWQgPSAwO1xuICAgIG1heFRpbWVvdXRJZCA9IHRpbWVvdXRJZCA9IHRyYWlsaW5nQ2FsbCA9IHVuZGVmaW5lZDtcbiAgfVxuXG4gIGZ1bmN0aW9uIGNvbXBsZXRlKGlzQ2FsbGVkLCBpZCkge1xuICAgIGlmIChpZCkge1xuICAgICAgY2xlYXJUaW1lb3V0KGlkKTtcbiAgICB9XG4gICAgbWF4VGltZW91dElkID0gdGltZW91dElkID0gdHJhaWxpbmdDYWxsID0gdW5kZWZpbmVkO1xuICAgIGlmIChpc0NhbGxlZCkge1xuICAgICAgbGFzdENhbGxlZCA9IG5vdygpO1xuICAgICAgcmVzdWx0ID0gZnVuYy5hcHBseSh0aGlzQXJnLCBhcmdzKTtcbiAgICAgIGlmICghdGltZW91dElkICYmICFtYXhUaW1lb3V0SWQpIHtcbiAgICAgICAgYXJncyA9IHRoaXNBcmcgPSB1bmRlZmluZWQ7XG4gICAgICB9XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gZGVsYXllZCgpIHtcbiAgICB2YXIgcmVtYWluaW5nID0gd2FpdCAtIChub3coKSAtIHN0YW1wKTtcbiAgICBpZiAocmVtYWluaW5nIDw9IDAgfHwgcmVtYWluaW5nID4gd2FpdCkge1xuICAgICAgY29tcGxldGUodHJhaWxpbmdDYWxsLCBtYXhUaW1lb3V0SWQpO1xuICAgIH0gZWxzZSB7XG4gICAgICB0aW1lb3V0SWQgPSBzZXRUaW1lb3V0KGRlbGF5ZWQsIHJlbWFpbmluZyk7XG4gICAgfVxuICB9XG5cbiAgZnVuY3Rpb24gbWF4RGVsYXllZCgpIHtcbiAgICBjb21wbGV0ZSh0cmFpbGluZywgdGltZW91dElkKTtcbiAgfVxuXG4gIGZ1bmN0aW9uIGRlYm91bmNlZCgpIHtcbiAgICBhcmdzID0gYXJndW1lbnRzO1xuICAgIHN0YW1wID0gbm93KCk7XG4gICAgdGhpc0FyZyA9IHRoaXM7XG4gICAgdHJhaWxpbmdDYWxsID0gdHJhaWxpbmcgJiYgKHRpbWVvdXRJZCB8fCAhbGVhZGluZyk7XG5cbiAgICBpZiAobWF4V2FpdCA9PT0gZmFsc2UpIHtcbiAgICAgIHZhciBsZWFkaW5nQ2FsbCA9IGxlYWRpbmcgJiYgIXRpbWVvdXRJZDtcbiAgICB9IGVsc2Uge1xuICAgICAgaWYgKCFtYXhUaW1lb3V0SWQgJiYgIWxlYWRpbmcpIHtcbiAgICAgICAgbGFzdENhbGxlZCA9IHN0YW1wO1xuICAgICAgfVxuICAgICAgdmFyIHJlbWFpbmluZyA9IG1heFdhaXQgLSAoc3RhbXAgLSBsYXN0Q2FsbGVkKSxcbiAgICAgICAgICBpc0NhbGxlZCA9IHJlbWFpbmluZyA8PSAwIHx8IHJlbWFpbmluZyA+IG1heFdhaXQ7XG5cbiAgICAgIGlmIChpc0NhbGxlZCkge1xuICAgICAgICBpZiAobWF4VGltZW91dElkKSB7XG4gICAgICAgICAgbWF4VGltZW91dElkID0gY2xlYXJUaW1lb3V0KG1heFRpbWVvdXRJZCk7XG4gICAgICAgIH1cbiAgICAgICAgbGFzdENhbGxlZCA9IHN0YW1wO1xuICAgICAgICByZXN1bHQgPSBmdW5jLmFwcGx5KHRoaXNBcmcsIGFyZ3MpO1xuICAgICAgfVxuICAgICAgZWxzZSBpZiAoIW1heFRpbWVvdXRJZCkge1xuICAgICAgICBtYXhUaW1lb3V0SWQgPSBzZXRUaW1lb3V0KG1heERlbGF5ZWQsIHJlbWFpbmluZyk7XG4gICAgICB9XG4gICAgfVxuICAgIGlmIChpc0NhbGxlZCAmJiB0aW1lb3V0SWQpIHtcbiAgICAgIHRpbWVvdXRJZCA9IGNsZWFyVGltZW91dCh0aW1lb3V0SWQpO1xuICAgIH1cbiAgICBlbHNlIGlmICghdGltZW91dElkICYmIHdhaXQgIT09IG1heFdhaXQpIHtcbiAgICAgIHRpbWVvdXRJZCA9IHNldFRpbWVvdXQoZGVsYXllZCwgd2FpdCk7XG4gICAgfVxuICAgIGlmIChsZWFkaW5nQ2FsbCkge1xuICAgICAgaXNDYWxsZWQgPSB0cnVlO1xuICAgICAgcmVzdWx0ID0gZnVuYy5hcHBseSh0aGlzQXJnLCBhcmdzKTtcbiAgICB9XG4gICAgaWYgKGlzQ2FsbGVkICYmICF0aW1lb3V0SWQgJiYgIW1heFRpbWVvdXRJZCkge1xuICAgICAgYXJncyA9IHRoaXNBcmcgPSB1bmRlZmluZWQ7XG4gICAgfVxuICAgIHJldHVybiByZXN1bHQ7XG4gIH1cbiAgZGVib3VuY2VkLmNhbmNlbCA9IGNhbmNlbDtcbiAgcmV0dXJuIGRlYm91bmNlZDtcbn1cblxuLyoqXG4gKiBDaGVja3MgaWYgYHZhbHVlYCBpcyB0aGUgW2xhbmd1YWdlIHR5cGVdKGh0dHBzOi8vZXM1LmdpdGh1Yi5pby8jeDgpIG9mIGBPYmplY3RgLlxuICogKGUuZy4gYXJyYXlzLCBmdW5jdGlvbnMsIG9iamVjdHMsIHJlZ2V4ZXMsIGBuZXcgTnVtYmVyKDApYCwgYW5kIGBuZXcgU3RyaW5nKCcnKWApXG4gKlxuICogQHN0YXRpY1xuICogQG1lbWJlck9mIF9cbiAqIEBjYXRlZ29yeSBMYW5nXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIGFuIG9iamVjdCwgZWxzZSBgZmFsc2VgLlxuICogQGV4YW1wbGVcbiAqXG4gKiBfLmlzT2JqZWN0KHt9KTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmlzT2JqZWN0KFsxLCAyLCAzXSk7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogXy5pc09iamVjdCgxKTtcbiAqIC8vID0+IGZhbHNlXG4gKi9cbmZ1bmN0aW9uIGlzT2JqZWN0KHZhbHVlKSB7XG4gIC8vIEF2b2lkIGEgVjggSklUIGJ1ZyBpbiBDaHJvbWUgMTktMjAuXG4gIC8vIFNlZSBodHRwczovL2NvZGUuZ29vZ2xlLmNvbS9wL3Y4L2lzc3Vlcy9kZXRhaWw/aWQ9MjI5MSBmb3IgbW9yZSBkZXRhaWxzLlxuICB2YXIgdHlwZSA9IHR5cGVvZiB2YWx1ZTtcbiAgcmV0dXJuICEhdmFsdWUgJiYgKHR5cGUgPT0gJ29iamVjdCcgfHwgdHlwZSA9PSAnZnVuY3Rpb24nKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBkZWJvdW5jZTtcbiIsIi8qKlxuICogbG9kYXNoIDMuOS4xIChDdXN0b20gQnVpbGQpIDxodHRwczovL2xvZGFzaC5jb20vPlxuICogQnVpbGQ6IGBsb2Rhc2ggbW9kZXJuIG1vZHVsYXJpemUgZXhwb3J0cz1cIm5wbVwiIC1vIC4vYFxuICogQ29weXJpZ2h0IDIwMTItMjAxNSBUaGUgRG9qbyBGb3VuZGF0aW9uIDxodHRwOi8vZG9qb2ZvdW5kYXRpb24ub3JnLz5cbiAqIEJhc2VkIG9uIFVuZGVyc2NvcmUuanMgMS44LjMgPGh0dHA6Ly91bmRlcnNjb3JlanMub3JnL0xJQ0VOU0U+XG4gKiBDb3B5cmlnaHQgMjAwOS0yMDE1IEplcmVteSBBc2hrZW5hcywgRG9jdW1lbnRDbG91ZCBhbmQgSW52ZXN0aWdhdGl2ZSBSZXBvcnRlcnMgJiBFZGl0b3JzXG4gKiBBdmFpbGFibGUgdW5kZXIgTUlUIGxpY2Vuc2UgPGh0dHBzOi8vbG9kYXNoLmNvbS9saWNlbnNlPlxuICovXG5cbi8qKiBgT2JqZWN0I3RvU3RyaW5nYCByZXN1bHQgcmVmZXJlbmNlcy4gKi9cbnZhciBmdW5jVGFnID0gJ1tvYmplY3QgRnVuY3Rpb25dJztcblxuLyoqIFVzZWQgdG8gZGV0ZWN0IGhvc3QgY29uc3RydWN0b3JzIChTYWZhcmkgPiA1KS4gKi9cbnZhciByZUlzSG9zdEN0b3IgPSAvXlxcW29iamVjdCAuKz9Db25zdHJ1Y3RvclxcXSQvO1xuXG4vKipcbiAqIENoZWNrcyBpZiBgdmFsdWVgIGlzIG9iamVjdC1saWtlLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0geyp9IHZhbHVlIFRoZSB2YWx1ZSB0byBjaGVjay5cbiAqIEByZXR1cm5zIHtib29sZWFufSBSZXR1cm5zIGB0cnVlYCBpZiBgdmFsdWVgIGlzIG9iamVjdC1saWtlLCBlbHNlIGBmYWxzZWAuXG4gKi9cbmZ1bmN0aW9uIGlzT2JqZWN0TGlrZSh2YWx1ZSkge1xuICByZXR1cm4gISF2YWx1ZSAmJiB0eXBlb2YgdmFsdWUgPT0gJ29iamVjdCc7XG59XG5cbi8qKiBVc2VkIGZvciBuYXRpdmUgbWV0aG9kIHJlZmVyZW5jZXMuICovXG52YXIgb2JqZWN0UHJvdG8gPSBPYmplY3QucHJvdG90eXBlO1xuXG4vKiogVXNlZCB0byByZXNvbHZlIHRoZSBkZWNvbXBpbGVkIHNvdXJjZSBvZiBmdW5jdGlvbnMuICovXG52YXIgZm5Ub1N0cmluZyA9IEZ1bmN0aW9uLnByb3RvdHlwZS50b1N0cmluZztcblxuLyoqIFVzZWQgdG8gY2hlY2sgb2JqZWN0cyBmb3Igb3duIHByb3BlcnRpZXMuICovXG52YXIgaGFzT3duUHJvcGVydHkgPSBvYmplY3RQcm90by5oYXNPd25Qcm9wZXJ0eTtcblxuLyoqXG4gKiBVc2VkIHRvIHJlc29sdmUgdGhlIFtgdG9TdHJpbmdUYWdgXShodHRwOi8vZWNtYS1pbnRlcm5hdGlvbmFsLm9yZy9lY21hLTI2Mi82LjAvI3NlYy1vYmplY3QucHJvdG90eXBlLnRvc3RyaW5nKVxuICogb2YgdmFsdWVzLlxuICovXG52YXIgb2JqVG9TdHJpbmcgPSBvYmplY3RQcm90by50b1N0cmluZztcblxuLyoqIFVzZWQgdG8gZGV0ZWN0IGlmIGEgbWV0aG9kIGlzIG5hdGl2ZS4gKi9cbnZhciByZUlzTmF0aXZlID0gUmVnRXhwKCdeJyArXG4gIGZuVG9TdHJpbmcuY2FsbChoYXNPd25Qcm9wZXJ0eSkucmVwbGFjZSgvW1xcXFxeJC4qKz8oKVtcXF17fXxdL2csICdcXFxcJCYnKVxuICAucmVwbGFjZSgvaGFzT3duUHJvcGVydHl8KGZ1bmN0aW9uKS4qPyg/PVxcXFxcXCgpfCBmb3IgLis/KD89XFxcXFxcXSkvZywgJyQxLio/JykgKyAnJCdcbik7XG5cbi8qKlxuICogR2V0cyB0aGUgbmF0aXZlIGZ1bmN0aW9uIGF0IGBrZXlgIG9mIGBvYmplY3RgLlxuICpcbiAqIEBwcml2YXRlXG4gKiBAcGFyYW0ge09iamVjdH0gb2JqZWN0IFRoZSBvYmplY3QgdG8gcXVlcnkuXG4gKiBAcGFyYW0ge3N0cmluZ30ga2V5IFRoZSBrZXkgb2YgdGhlIG1ldGhvZCB0byBnZXQuXG4gKiBAcmV0dXJucyB7Kn0gUmV0dXJucyB0aGUgZnVuY3Rpb24gaWYgaXQncyBuYXRpdmUsIGVsc2UgYHVuZGVmaW5lZGAuXG4gKi9cbmZ1bmN0aW9uIGdldE5hdGl2ZShvYmplY3QsIGtleSkge1xuICB2YXIgdmFsdWUgPSBvYmplY3QgPT0gbnVsbCA/IHVuZGVmaW5lZCA6IG9iamVjdFtrZXldO1xuICByZXR1cm4gaXNOYXRpdmUodmFsdWUpID8gdmFsdWUgOiB1bmRlZmluZWQ7XG59XG5cbi8qKlxuICogQ2hlY2tzIGlmIGB2YWx1ZWAgaXMgY2xhc3NpZmllZCBhcyBhIGBGdW5jdGlvbmAgb2JqZWN0LlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAY2F0ZWdvcnkgTGFuZ1xuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBjb3JyZWN0bHkgY2xhc3NpZmllZCwgZWxzZSBgZmFsc2VgLlxuICogQGV4YW1wbGVcbiAqXG4gKiBfLmlzRnVuY3Rpb24oXyk7XG4gKiAvLyA9PiB0cnVlXG4gKlxuICogXy5pc0Z1bmN0aW9uKC9hYmMvKTtcbiAqIC8vID0+IGZhbHNlXG4gKi9cbmZ1bmN0aW9uIGlzRnVuY3Rpb24odmFsdWUpIHtcbiAgLy8gVGhlIHVzZSBvZiBgT2JqZWN0I3RvU3RyaW5nYCBhdm9pZHMgaXNzdWVzIHdpdGggdGhlIGB0eXBlb2ZgIG9wZXJhdG9yXG4gIC8vIGluIG9sZGVyIHZlcnNpb25zIG9mIENocm9tZSBhbmQgU2FmYXJpIHdoaWNoIHJldHVybiAnZnVuY3Rpb24nIGZvciByZWdleGVzXG4gIC8vIGFuZCBTYWZhcmkgOCBlcXVpdmFsZW50cyB3aGljaCByZXR1cm4gJ29iamVjdCcgZm9yIHR5cGVkIGFycmF5IGNvbnN0cnVjdG9ycy5cbiAgcmV0dXJuIGlzT2JqZWN0KHZhbHVlKSAmJiBvYmpUb1N0cmluZy5jYWxsKHZhbHVlKSA9PSBmdW5jVGFnO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBgdmFsdWVgIGlzIHRoZSBbbGFuZ3VhZ2UgdHlwZV0oaHR0cHM6Ly9lczUuZ2l0aHViLmlvLyN4OCkgb2YgYE9iamVjdGAuXG4gKiAoZS5nLiBhcnJheXMsIGZ1bmN0aW9ucywgb2JqZWN0cywgcmVnZXhlcywgYG5ldyBOdW1iZXIoMClgLCBhbmQgYG5ldyBTdHJpbmcoJycpYClcbiAqXG4gKiBAc3RhdGljXG4gKiBAbWVtYmVyT2YgX1xuICogQGNhdGVnb3J5IExhbmdcbiAqIEBwYXJhbSB7Kn0gdmFsdWUgVGhlIHZhbHVlIHRvIGNoZWNrLlxuICogQHJldHVybnMge2Jvb2xlYW59IFJldHVybnMgYHRydWVgIGlmIGB2YWx1ZWAgaXMgYW4gb2JqZWN0LCBlbHNlIGBmYWxzZWAuXG4gKiBAZXhhbXBsZVxuICpcbiAqIF8uaXNPYmplY3Qoe30pO1xuICogLy8gPT4gdHJ1ZVxuICpcbiAqIF8uaXNPYmplY3QoWzEsIDIsIDNdKTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmlzT2JqZWN0KDEpO1xuICogLy8gPT4gZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNPYmplY3QodmFsdWUpIHtcbiAgLy8gQXZvaWQgYSBWOCBKSVQgYnVnIGluIENocm9tZSAxOS0yMC5cbiAgLy8gU2VlIGh0dHBzOi8vY29kZS5nb29nbGUuY29tL3AvdjgvaXNzdWVzL2RldGFpbD9pZD0yMjkxIGZvciBtb3JlIGRldGFpbHMuXG4gIHZhciB0eXBlID0gdHlwZW9mIHZhbHVlO1xuICByZXR1cm4gISF2YWx1ZSAmJiAodHlwZSA9PSAnb2JqZWN0JyB8fCB0eXBlID09ICdmdW5jdGlvbicpO1xufVxuXG4vKipcbiAqIENoZWNrcyBpZiBgdmFsdWVgIGlzIGEgbmF0aXZlIGZ1bmN0aW9uLlxuICpcbiAqIEBzdGF0aWNcbiAqIEBtZW1iZXJPZiBfXG4gKiBAY2F0ZWdvcnkgTGFuZ1xuICogQHBhcmFtIHsqfSB2YWx1ZSBUaGUgdmFsdWUgdG8gY2hlY2suXG4gKiBAcmV0dXJucyB7Ym9vbGVhbn0gUmV0dXJucyBgdHJ1ZWAgaWYgYHZhbHVlYCBpcyBhIG5hdGl2ZSBmdW5jdGlvbiwgZWxzZSBgZmFsc2VgLlxuICogQGV4YW1wbGVcbiAqXG4gKiBfLmlzTmF0aXZlKEFycmF5LnByb3RvdHlwZS5wdXNoKTtcbiAqIC8vID0+IHRydWVcbiAqXG4gKiBfLmlzTmF0aXZlKF8pO1xuICogLy8gPT4gZmFsc2VcbiAqL1xuZnVuY3Rpb24gaXNOYXRpdmUodmFsdWUpIHtcbiAgaWYgKHZhbHVlID09IG51bGwpIHtcbiAgICByZXR1cm4gZmFsc2U7XG4gIH1cbiAgaWYgKGlzRnVuY3Rpb24odmFsdWUpKSB7XG4gICAgcmV0dXJuIHJlSXNOYXRpdmUudGVzdChmblRvU3RyaW5nLmNhbGwodmFsdWUpKTtcbiAgfVxuICByZXR1cm4gaXNPYmplY3RMaWtlKHZhbHVlKSAmJiByZUlzSG9zdEN0b3IudGVzdCh2YWx1ZSk7XG59XG5cbm1vZHVsZS5leHBvcnRzID0gZ2V0TmF0aXZlO1xuIiwiLyogZXNsaW50LWRpc2FibGUgbm8tdW51c2VkLXZhcnMgKi9cbid1c2Ugc3RyaWN0JztcbnZhciBoYXNPd25Qcm9wZXJ0eSA9IE9iamVjdC5wcm90b3R5cGUuaGFzT3duUHJvcGVydHk7XG52YXIgcHJvcElzRW51bWVyYWJsZSA9IE9iamVjdC5wcm90b3R5cGUucHJvcGVydHlJc0VudW1lcmFibGU7XG5cbmZ1bmN0aW9uIHRvT2JqZWN0KHZhbCkge1xuXHRpZiAodmFsID09PSBudWxsIHx8IHZhbCA9PT0gdW5kZWZpbmVkKSB7XG5cdFx0dGhyb3cgbmV3IFR5cGVFcnJvcignT2JqZWN0LmFzc2lnbiBjYW5ub3QgYmUgY2FsbGVkIHdpdGggbnVsbCBvciB1bmRlZmluZWQnKTtcblx0fVxuXG5cdHJldHVybiBPYmplY3QodmFsKTtcbn1cblxubW9kdWxlLmV4cG9ydHMgPSBPYmplY3QuYXNzaWduIHx8IGZ1bmN0aW9uICh0YXJnZXQsIHNvdXJjZSkge1xuXHR2YXIgZnJvbTtcblx0dmFyIHRvID0gdG9PYmplY3QodGFyZ2V0KTtcblx0dmFyIHN5bWJvbHM7XG5cblx0Zm9yICh2YXIgcyA9IDE7IHMgPCBhcmd1bWVudHMubGVuZ3RoOyBzKyspIHtcblx0XHRmcm9tID0gT2JqZWN0KGFyZ3VtZW50c1tzXSk7XG5cblx0XHRmb3IgKHZhciBrZXkgaW4gZnJvbSkge1xuXHRcdFx0aWYgKGhhc093blByb3BlcnR5LmNhbGwoZnJvbSwga2V5KSkge1xuXHRcdFx0XHR0b1trZXldID0gZnJvbVtrZXldO1xuXHRcdFx0fVxuXHRcdH1cblxuXHRcdGlmIChPYmplY3QuZ2V0T3duUHJvcGVydHlTeW1ib2xzKSB7XG5cdFx0XHRzeW1ib2xzID0gT2JqZWN0LmdldE93blByb3BlcnR5U3ltYm9scyhmcm9tKTtcblx0XHRcdGZvciAodmFyIGkgPSAwOyBpIDwgc3ltYm9scy5sZW5ndGg7IGkrKykge1xuXHRcdFx0XHRpZiAocHJvcElzRW51bWVyYWJsZS5jYWxsKGZyb20sIHN5bWJvbHNbaV0pKSB7XG5cdFx0XHRcdFx0dG9bc3ltYm9sc1tpXV0gPSBmcm9tW3N5bWJvbHNbaV1dO1xuXHRcdFx0XHR9XG5cdFx0XHR9XG5cdFx0fVxuXHR9XG5cblx0cmV0dXJuIHRvO1xufTtcbiIsIi8qKlxuICogTW9kdWxlIGRlcGVuZGVuY2llcy5cbiAqL1xuXG52YXIgc2xpY2UgPSByZXF1aXJlKCdzbGljZWQnKVxudmFyIGZsYXR0ZW4gPSByZXF1aXJlKCdhcnJheS1mbGF0dGVuJylcblxuLyoqXG4gKiBUaGlzIGZ1bmN0aW9uIGxldHMgdXMgY3JlYXRlIHZpcnR1YWwgbm9kZXMgdXNpbmcgYSBzaW1wbGVcbiAqIHN5bnRheC4gSXQgaXMgY29tcGF0aWJsZSB3aXRoIEpTWCB0cmFuc2Zvcm1zIHNvIHlvdSBjYW4gdXNlXG4gKiBKU1ggdG8gd3JpdGUgbm9kZXMgdGhhdCB3aWxsIGNvbXBpbGUgdG8gdGhpcyBmdW5jdGlvbi5cbiAqXG4gKiBsZXQgbm9kZSA9IGVsZW1lbnQoJ2RpdicsIHsgaWQ6ICdmb28nIH0sIFtcbiAqICAgZWxlbWVudCgnYScsIHsgaHJlZjogJ2h0dHA6Ly9nb29nbGUuY29tJyB9LCAnR29vZ2xlJylcbiAqIF0pXG4gKlxuICogWW91IGNhbiBsZWF2ZSBvdXQgdGhlIGF0dHJpYnV0ZXMgb3IgdGhlIGNoaWxkcmVuIGlmIGVpdGhlclxuICogb2YgdGhlbSBhcmVuJ3QgbmVlZGVkIGFuZCBpdCB3aWxsIGZpZ3VyZSBvdXQgd2hhdCB5b3UncmVcbiAqIHRyeWluZyB0byBkby5cbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGVsZW1lbnRcblxuLyoqXG4gKiBDcmVhdGUgdmlydHVhbCB0cmVlcyBvZiBjb21wb25lbnRzLlxuICpcbiAqIFRoaXMgY3JlYXRlcyB0aGUgbmljZXIgQVBJIGZvciB0aGUgdXNlci5cbiAqIEl0IHRyYW5zbGF0ZXMgdGhhdCBmcmllbmRseSBBUEkgaW50byBhbiBhY3R1YWwgdHJlZSBvZiBub2Rlcy5cbiAqXG4gKiBAcGFyYW0geyp9IHR5cGVcbiAqIEBwYXJhbSB7T2JqZWN0fSBhdHRyaWJ1dGVzXG4gKiBAcGFyYW0ge0FycmF5fSBjaGlsZHJlblxuICogQHJldHVybiB7T2JqZWN0fVxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5mdW5jdGlvbiBlbGVtZW50ICh0eXBlLCBhdHRyaWJ1dGVzLCBjaGlsZHJlbikge1xuICAvLyBEZWZhdWx0IHRvIGRpdiB3aXRoIG5vIGFyZ3NcbiAgaWYgKCF0eXBlKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignZWxlbWVudCgpIG5lZWRzIGEgdHlwZS4nKVxuICB9XG5cbiAgLy8gU2tpcHBlZCBhZGRpbmcgYXR0cmlidXRlcyBhbmQgd2UncmUgcGFzc2luZ1xuICAvLyBpbiBjaGlsZHJlbiBpbnN0ZWFkLlxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMiAmJiAodHlwZW9mIGF0dHJpYnV0ZXMgPT09ICdzdHJpbmcnIHx8IEFycmF5LmlzQXJyYXkoYXR0cmlidXRlcykpKSB7XG4gICAgY2hpbGRyZW4gPSBbIGF0dHJpYnV0ZXMgXVxuICAgIGF0dHJpYnV0ZXMgPSB7fVxuICB9XG5cbiAgLy8gQWNjb3VudCBmb3IgSlNYIHB1dHRpbmcgdGhlIGNoaWxkcmVuIGFzIG11bHRpcGxlIGFyZ3VtZW50cy5cbiAgLy8gVGhpcyBpcyBlc3NlbnRpYWxseSBqdXN0IHRoZSBFUzYgcmVzdCBwYXJhbVxuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA+IDIpIHtcbiAgICBjaGlsZHJlbiA9IHNsaWNlKGFyZ3VtZW50cywgMilcbiAgfVxuXG4gIGNoaWxkcmVuID0gY2hpbGRyZW4gfHwgW11cbiAgYXR0cmlidXRlcyA9IGF0dHJpYnV0ZXMgfHwge31cblxuICAvLyBGbGF0dGVuIG5lc3RlZCBjaGlsZCBhcnJheXMuIFRoaXMgaXMgaG93IEpTWCBjb21waWxlcyBzb21lIG5vZGVzLlxuICBjaGlsZHJlbiA9IGZsYXR0ZW4oY2hpbGRyZW4sIDIpXG5cbiAgLy8gRmlsdGVyIG91dCBhbnkgYHVuZGVmaW5lZGAgZWxlbWVudHNcbiAgY2hpbGRyZW4gPSBjaGlsZHJlbi5maWx0ZXIoZnVuY3Rpb24gKGkpIHsgcmV0dXJuIHR5cGVvZiBpICE9PSAndW5kZWZpbmVkJyB9KVxuXG4gIC8vIGlmIHlvdSBwYXNzIGluIGEgZnVuY3Rpb24sIGl0J3MgYSBgQ29tcG9uZW50YCBjb25zdHJ1Y3Rvci5cbiAgLy8gb3RoZXJ3aXNlIGl0J3MgYW4gZWxlbWVudC5cbiAgcmV0dXJuIHtcbiAgICB0eXBlOiB0eXBlLFxuICAgIGNoaWxkcmVuOiBjaGlsZHJlbixcbiAgICBhdHRyaWJ1dGVzOiBhdHRyaWJ1dGVzXG4gIH1cbn1cbiIsIid1c2Ugc3RyaWN0J1xuXG4vKipcbiAqIEV4cG9zZSBgYXJyYXlGbGF0dGVuYC5cbiAqL1xubW9kdWxlLmV4cG9ydHMgPSBhcnJheUZsYXR0ZW5cblxuLyoqXG4gKiBSZWN1cnNpdmUgZmxhdHRlbiBmdW5jdGlvbiB3aXRoIGRlcHRoLlxuICpcbiAqIEBwYXJhbSAge0FycmF5fSAgYXJyYXlcbiAqIEBwYXJhbSAge0FycmF5fSAgcmVzdWx0XG4gKiBAcGFyYW0gIHtOdW1iZXJ9IGRlcHRoXG4gKiBAcmV0dXJuIHtBcnJheX1cbiAqL1xuZnVuY3Rpb24gZmxhdHRlbldpdGhEZXB0aCAoYXJyYXksIHJlc3VsdCwgZGVwdGgpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcnJheS5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2YWx1ZSA9IGFycmF5W2ldXG5cbiAgICBpZiAoZGVwdGggPiAwICYmIEFycmF5LmlzQXJyYXkodmFsdWUpKSB7XG4gICAgICBmbGF0dGVuV2l0aERlcHRoKHZhbHVlLCByZXN1bHQsIGRlcHRoIC0gMSlcbiAgICB9IGVsc2Uge1xuICAgICAgcmVzdWx0LnB1c2godmFsdWUpXG4gICAgfVxuICB9XG5cbiAgcmV0dXJuIHJlc3VsdFxufVxuXG4vKipcbiAqIFJlY3Vyc2l2ZSBmbGF0dGVuIGZ1bmN0aW9uLiBPbWl0dGluZyBkZXB0aCBpcyBzbGlnaHRseSBmYXN0ZXIuXG4gKlxuICogQHBhcmFtICB7QXJyYXl9IGFycmF5XG4gKiBAcGFyYW0gIHtBcnJheX0gcmVzdWx0XG4gKiBAcmV0dXJuIHtBcnJheX1cbiAqL1xuZnVuY3Rpb24gZmxhdHRlbkZvcmV2ZXIgKGFycmF5LCByZXN1bHQpIHtcbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBhcnJheS5sZW5ndGg7IGkrKykge1xuICAgIHZhciB2YWx1ZSA9IGFycmF5W2ldXG5cbiAgICBpZiAoQXJyYXkuaXNBcnJheSh2YWx1ZSkpIHtcbiAgICAgIGZsYXR0ZW5Gb3JldmVyKHZhbHVlLCByZXN1bHQpXG4gICAgfSBlbHNlIHtcbiAgICAgIHJlc3VsdC5wdXNoKHZhbHVlKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiByZXN1bHRcbn1cblxuLyoqXG4gKiBGbGF0dGVuIGFuIGFycmF5LCB3aXRoIHRoZSBhYmlsaXR5IHRvIGRlZmluZSBhIGRlcHRoLlxuICpcbiAqIEBwYXJhbSAge0FycmF5fSAgYXJyYXlcbiAqIEBwYXJhbSAge051bWJlcn0gZGVwdGhcbiAqIEByZXR1cm4ge0FycmF5fVxuICovXG5mdW5jdGlvbiBhcnJheUZsYXR0ZW4gKGFycmF5LCBkZXB0aCkge1xuICBpZiAoZGVwdGggPT0gbnVsbCkge1xuICAgIHJldHVybiBmbGF0dGVuRm9yZXZlcihhcnJheSwgW10pXG4gIH1cblxuICByZXR1cm4gZmxhdHRlbldpdGhEZXB0aChhcnJheSwgW10sIGRlcHRoKVxufVxuIiwibW9kdWxlLmV4cG9ydHMgPSBleHBvcnRzID0gcmVxdWlyZSgnLi9saWIvc2xpY2VkJyk7XG4iLCJcbi8qKlxuICogQW4gQXJyYXkucHJvdG90eXBlLnNsaWNlLmNhbGwoYXJndW1lbnRzKSBhbHRlcm5hdGl2ZVxuICpcbiAqIEBwYXJhbSB7T2JqZWN0fSBhcmdzIHNvbWV0aGluZyB3aXRoIGEgbGVuZ3RoXG4gKiBAcGFyYW0ge051bWJlcn0gc2xpY2VcbiAqIEBwYXJhbSB7TnVtYmVyfSBzbGljZUVuZFxuICogQGFwaSBwdWJsaWNcbiAqL1xuXG5tb2R1bGUuZXhwb3J0cyA9IGZ1bmN0aW9uIChhcmdzLCBzbGljZSwgc2xpY2VFbmQpIHtcbiAgdmFyIHJldCA9IFtdO1xuICB2YXIgbGVuID0gYXJncy5sZW5ndGg7XG5cbiAgaWYgKDAgPT09IGxlbikgcmV0dXJuIHJldDtcblxuICB2YXIgc3RhcnQgPSBzbGljZSA8IDBcbiAgICA/IE1hdGgubWF4KDAsIHNsaWNlICsgbGVuKVxuICAgIDogc2xpY2UgfHwgMDtcblxuICBpZiAoc2xpY2VFbmQgIT09IHVuZGVmaW5lZCkge1xuICAgIGxlbiA9IHNsaWNlRW5kIDwgMFxuICAgICAgPyBzbGljZUVuZCArIGxlblxuICAgICAgOiBzbGljZUVuZFxuICB9XG5cbiAgd2hpbGUgKGxlbi0tID4gc3RhcnQpIHtcbiAgICByZXRbbGVuIC0gc3RhcnRdID0gYXJnc1tsZW5dO1xuICB9XG5cbiAgcmV0dXJuIHJldDtcbn1cblxuIiwiaW1wb3J0IHsgQUNUSU9OUyB9IGZyb20gJy4vY29yZS9jb25zdGFudHMnXG5pbXBvcnQgRGlzcGF0Y2hlciBmcm9tICcuL2NvcmUvZGlzcGF0Y2hlcidcbmltcG9ydCBBcHBsaWNhdGlvbiBmcm9tICcuL2NvcmUvYXBwbGljYXRpb24nXG5cbkFwcGxpY2F0aW9uLnN0YXJ0KClcbiIsImltcG9ydCBlbGVtZW50IGZyb20gJ3ZpcnR1YWwtZWxlbWVudCdcblxuaW1wb3J0IERvY3VtZW50RWRpdG9yIGZyb20gJy4vZG9jLWVkaXRvcidcbmltcG9ydCBEb2N1bWVudExpc3QgZnJvbSAnLi9kb2MtbGlzdCdcbmltcG9ydCBEb2N1bWVudFRvb2xiYXIgZnJvbSAnLi9kb2MtdG9vbGJhcidcbmltcG9ydCBJbXBvcnQgZnJvbSAnLi9pbXBvcnQnXG5cbmV4cG9ydCBkZWZhdWx0IHtcbiAgcmVuZGVyOiAoKSA9PlxuICAgIDxkaXYgY2xhc3M9XCJ1aSBjb250YWluZXJcIj5cbiAgICAgIDxEb2N1bWVudFRvb2xiYXIgLz5cbiAgICAgIDxEb2N1bWVudExpc3QgdGl0bGU9XCJkb2N1bWVudHNcIiAvPlxuICAgICAgPERvY3VtZW50RWRpdG9yIC8+XG4gICAgICA8SW1wb3J0IC8+XG4gICAgPC9kaXY+XG59XG4iLCJpbXBvcnQgZWxlbWVudCBmcm9tICd2aXJ0dWFsLWVsZW1lbnQnXG5pbXBvcnQge0FDVElPTlN9IGZyb20gJy4uL2NvcmUvY29uc3RhbnRzJztcbmltcG9ydCBEaXNwYXRjaGVyIGZyb20gJy4uL2NvcmUvZGlzcGF0Y2hlcic7XG5pbXBvcnQgRG9jdW1lbnRTdG9yZSBmcm9tICcuLi9zdG9yZXMvZG9jdW1lbnQnXG5pbXBvcnQgZGVib3VuY2UgZnJvbSAnbG9kYXNoLmRlYm91bmNlJ1xuXG5sZXQgdHJhaWxpbmdTYXZlID0gZGVib3VuY2UoKGRvY3VtZW50SWQsIGJvZHkpID0+IHtcbiAgY29uc29sZS5sb2coJ2RlYm91bmNlIHNhdmUnKVxuICBEb2N1bWVudFN0b3JlLnNhdmUoZG9jdW1lbnRJZCwgeyBib2R5IH0pXG59LCA1MDAsIHsgbGVhZGluZzogZmFsc2UsIG1heFdhaXQ6IDUwMDAsICB0cmFpbGluZzogdHJ1ZSwgfSlcblxuXG5sZXQgRG9jdW1lbnRFZGl0b3IgPSB7XG4gIGluaXRpYWxTdGF0ZShwcm9wcykge1xuICAgIHJldHVybiB7XG4gICAgICBsb2FkZWQ6IGZhbHNlLFxuICAgICAgZG9jOiBudWxsLFxuICAgICAgc2F2ZUhhbmRsZXI6ICgpID0+IHt9LFxuICAgICAgb2ZmU2F2ZTogeyBvZmY6ICgpID0+IHt9IH0sXG4gICAgfVxuICB9LFxuICBzaG91bGRVcGRhdGUoY29tcG9uZW50LCBuZXh0UHJvcHMsIG5leHRTdGF0ZSkge1xuICAgIGxldCB7cHJvcHMsIHN0YXRlLCBpZH0gPSBjb21wb25lbnRcbiAgICByZXR1cm4gc3RhdGUuZG9jICE9PSBuZXh0U3RhdGUuZG9jXG4gIH0sXG5cbiAgYmVmb3JlVXBkYXRlKGNvbXBvbmVudCwgbmV4dFByb3BzLCBuZXh0U3RhdGUpIHtcbiAgICBsZXQge3Byb3BzLCBzdGF0ZSwgaWR9ID0gY29tcG9uZW50XG4gICAgaWYgKHR5cGVvZiBzdGF0ZS5lZGl0b3IgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgICBzdGF0ZS5lZGl0b3IucmVtb3ZlTGlzdGVuZXIoXCJ1cGRhdGVcIilcbiAgICB9XG4gICAgc3RhdGUub2ZmU2F2ZS5vZmYoKVxuICB9LFxuXG4gIGFmdGVyVXBkYXRlKGNvbXBvbmVudCwgcHJldlByb3BzLCBwcmV2U3RhdGUsIHNldFN0YXRlKSB7XG4gICAgbGV0IHtwcm9wcywgc3RhdGUsIGlkfSA9IGNvbXBvbmVudFxuICAgIHN0YXRlLmVkaXRvci5pbXBvcnRGaWxlKHN0YXRlLmRvYy5pZCwgc3RhdGUuZG9jLmJvZHkpXG5cbiAgICBzdGF0ZS5lZGl0b3Iub24oXCJ1cGRhdGVcIiwgKCkgPT4ge1xuICAgICAgLy8gaW1tZWRpYXRlbHkgY2FjaGUgdGhlIGh0bWwgYm9keXpcbiAgICAgIGxldCBib2R5ID0gc3RhdGUuZWRpdG9yLmV4cG9ydEZpbGUoKVxuICAgICAgbGV0IGRvY3VtZW50SWQgPSBzdGF0ZS5kb2MuaWRcbiAgICAgIHRyYWlsaW5nU2F2ZShkb2N1bWVudElkLCBib2R5KVxuICAgIH0pXG4gICAgLy8gZG9jdW1lbnQgc2VsZWN0ZWQgbGlzdGVuZXJcbiAgICBzZXRTdGF0ZSh7XG4gICAgICBvZmZTYXZlOiBEaXNwYXRjaGVyLm9uQWN0aW9uKEFDVElPTlMuU0FWRV9ET0NVTUVOVCwgYXN5bmMgKCkgPT4ge1xuICAgICAgICBsZXQgYm9keSA9IHN0YXRlLmVkaXRvci5leHBvcnRGaWxlKClcbiAgICAgICAgbGV0IGRvY3VtZW50SWQgPSBzdGF0ZS5kb2MuaWRcbiAgICAgICAgYXdhaXQgRG9jdW1lbnRTdG9yZS5zYXZlKGRvY3VtZW50SWQsIHsgYm9keSB9KVxuICAgICAgICBhd2FpdCBEb2N1bWVudFN0b3JlLnN5bmMoKVxuICAgICAgfSlcbiAgICB9KVxuICB9LFxuXG4gIGFzeW5jIGFmdGVyTW91bnQoYywgZWwsIHNldFN0YXRlKSB7XG4gICAgbGV0IGVkaXRvciA9IG5ldyBFcGljRWRpdG9yKHtcbiAgICAgIGNsaWVudFNpZGVTdG9yYWdlOiBmYWxzZSxcbiAgICAgIGJhc2VQYXRoOiAnZXBpY2VkaXRvcicsXG4gICAgICBhdXRvZ3JvdzogdHJ1ZSxcbiAgICAgIG1pbkhlaWdodDogKCkgPT4gTWF0aC5tYXgoXG4gICAgICAgICAgZG9jdW1lbnQuYm9keS5zY3JvbGxIZWlnaHQsXG4gICAgICAgICAgZG9jdW1lbnQuYm9keS5vZmZzZXRIZWlnaHQsXG4gICAgICAgICAgZG9jdW1lbnQuZG9jdW1lbnRFbGVtZW50LmNsaWVudEhlaWdodCxcbiAgICAgICAgICBkb2N1bWVudC5kb2N1bWVudEVsZW1lbnQuc2Nyb2xsSGVpZ2h0LFxuICAgICAgICAgIGRvY3VtZW50LmRvY3VtZW50RWxlbWVudC5vZmZzZXRIZWlnaHQpXG4gICAgfSlcbiAgICBlZGl0b3IubG9hZCgpXG4gICAgc2V0U3RhdGUoe1xuICAgICAgZWRpdG9yOiBlZGl0b3JcbiAgICB9KVxuICAgIERpc3BhdGNoZXIub25BY3Rpb24oQUNUSU9OUy5GVUxMU0NSRUVOX0RPQ1VNRU5ULCAoKSA9PiBlZGl0b3IuZW50ZXJGdWxsc2NyZWVuKCkpXG4gICAgRGlzcGF0Y2hlci5vbkFjdGlvbihBQ1RJT05TLlBSRVZJRVdfRE9DVU1FTlQsICgpID0+IGVkaXRvci5pcygncHJldmlldycpID8gZWRpdG9yLmVkaXQoKSA6IGVkaXRvci5wcmV2aWV3KCkpXG4gICAgRG9jdW1lbnRTdG9yZS5vbkFjdGlvbigndXBkYXRlJywgYXN5bmMoZGF0YSkgPT4ge1xuICAgICAgdHJ5IHtcbiAgICAgICAgbGV0IGRvYyA9IERvY3VtZW50U3RvcmUuZ2V0U3RhdGUoKS5zZWxlY3RlZFxuICAgICAgICBzZXRTdGF0ZSh7XG4gICAgICAgICAgbG9hZGVkOiB0cnVlLFxuICAgICAgICAgIGRvYzogZG9jLFxuICAgICAgICB9KVxuICAgICAgfSBjYXRjaCAoZSkge1xuICAgICAgICBjb25zb2xlLmVycm9yKGUpXG4gICAgICB9XG4gICAgfSlcbiAgfSxcbiAgcmVuZGVyKHsgcHJvcHMsIHN0YXRlIH0sIHNldFN0YXRlKSB7XG4gICAgcmV0dXJuIDxkaXYgaWQ9XCJlcGljZWRpdG9yXCI+PC9kaXY+XG4gIH1cbn1cbmV4cG9ydCBkZWZhdWx0IERvY3VtZW50RWRpdG9yXG4iLCJpbXBvcnQgZWxlbWVudCBmcm9tICd2aXJ0dWFsLWVsZW1lbnQnXG5cbmltcG9ydCB7QUNUSU9OU30gZnJvbSAnLi4vY29yZS9jb25zdGFudHMnO1xuaW1wb3J0IERpc3BhdGNoZXIgZnJvbSAnLi4vY29yZS9kaXNwYXRjaGVyJztcbmltcG9ydCBEb2N1bWVudFN0b3JlIGZyb20gJy4uL3N0b3Jlcy9kb2N1bWVudCdcblxuXG5sZXQgTG9hZGVyID0ge1xuICByZW5kZXIoe3Byb3BzfSkge1xuICAgIHJldHVybiA8ZGl2IGNsYXNzPXtgdWkgJHtwcm9wcy5hY3RpdmUgPyBcImFjdGl2ZVwiIDogXCJcIn0gZGltbWVyYH0+XG4gICAgICA8ZGl2IGNsYXNzPVwidWkgdGV4dCBsb2FkZXJcIj5Mb2FkaW5nPC9kaXY+XG4gICAgPC9kaXY+XG4gIH1cbn1cblxubGV0IERvY3VtZW50SXRlbSA9IHtcbiAgcmVuZGVyOiBjID0+IHtcbiAgICBsZXQgX2l0ZW0gPSBjLnByb3BzLml0ZW1cbiAgICBsZXQgc2VsZWN0ID0gKCkgPT4gRGlzcGF0Y2hlci5kaXNwYXRjaEFjdGlvbihBQ1RJT05TLlNFTEVDVF9ET0NVTUVOVCwgeyBpZDogX2l0ZW0uaWQgIH0pXG4gICAgbGV0IFdyYXAgPSB7XG4gICAgICByZW5kZXIgKHtwcm9wc30pIHtcbiAgICAgICAgaWYgKGMucHJvcHMuYWN0aXZlKVxuICAgICAgICAgIHJldHVybiA8ZGl2IGNsYXNzPVwiYWN0aXZlIGl0ZW1cIj57cHJvcHMuY2hpbGRyZW59PC9kaXY+XG4gICAgICAgIHJldHVybiA8YSBjbGFzcz1cIml0ZW1cIiBvbkNsaWNrPXtzZWxlY3R9Pntwcm9wcy5jaGlsZHJlbn08L2E+XG4gICAgICB9XG4gICAgfVxuXG4gICAgcmV0dXJuIDxXcmFwPntfaXRlbS5uYW1lfTwvV3JhcD5cbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCB7XG4gIG5hbWU6ICdEb2N1bWVudExpc3QnLFxuICBpbml0aWFsU3RhdGUocHJvcHMpIHtcbiAgICByZXR1cm4ge1xuICAgICAgZG9jdW1lbnRzOiBbXSxcbiAgICAgIHNlbGVjdGVkOiBudWxsLFxuICAgICAgbG9hZGluZzogZmFsc2UsXG4gICAgICBkb2NzSGFuZGxlcjogeyBvZmYgOiAoKSA9PiB7fX1cbiAgICB9XG4gIH0sXG4gIGFmdGVyTW91bnQoY29tcG9uZW50LCBlbCwgc2V0U3RhdGUpIHtcbiAgICBsZXQgeyBkb2N1bWVudHM9W10gfSA9IERvY3VtZW50U3RvcmUuZ2V0U3RhdGUoKVxuICAgIHNldFN0YXRlKHtcbiAgICAgIGRvY3VtZW50czogZG9jdW1lbnRzLFxuICAgICAgZG9jc0hhbmRsZXI6IERvY3VtZW50U3RvcmUub25BY3Rpb24oJ3VwZGF0ZScsIGRhdGEgPT4ge1xuICAgICAgICBzZXRTdGF0ZSh7XG4gICAgICAgICAgZG9jdW1lbnRzOiBEb2N1bWVudFN0b3JlLmdldFN0YXRlKCkuZG9jdW1lbnRzLFxuICAgICAgICAgIHNlbGVjdGVkOiBkYXRhLnNlbGVjdGVkID8gZGF0YS5zZWxlY3RlZC5pZCA6IG51bGwsXG4gICAgICAgICAgbG9hZGluZzogZmFsc2UsXG4gICAgICAgIH0pXG4gICAgICB9KVxuICAgIH0pXG4gIH0sXG4gIGJlZm9yZVVubW91bnQgKGNvbXBvbmVudCwgZWwpIHtcbiAgICBsZXQge3Byb3BzLCBzdGF0ZSwgaWR9ID0gY29tcG9uZW50XG4gICAgc3RhdGUuZG9jc0hhbmRsZXIub2ZmKClcbiAgfSxcbiAgcmVuZGVyKHsgcHJvcHMsIHN0YXRlIH0sIHNldFN0YXRlKSB7XG4gICAgbGV0IHsgZG9jdW1lbnRzIH0gPSBzdGF0ZVxuXG4gICAgbGV0IGxpc3QgPSBkb2N1bWVudHMubWFwKGl0ZW0gPT4gPERvY3VtZW50SXRlbSBhY3RpdmU9e2l0ZW0uaWQgPT09IHN0YXRlLnNlbGVjdGVkfSBpdGVtPXtpdGVtfSAvPilcblxuICAgIHJldHVybiA8ZGl2IGlkPVwiZG9jdW1lbnQtbGlzdFwiIGNsYXNzPVwidWkgbGVmdCBmaXhlZCB2ZXJ0aWNhbCBtZW51XCI+XG4gICAgICA8ZGl2IGNsYXNzPVwidWkgaG9yaXpvbnRhbCBkaXZpZGVyXCI+Tm90ZVBhZDwvZGl2PlxuICAgICAgPExvYWRlciBhY3RpdmU9e3N0YXRlLmxvYWRpbmd9PkxvYWRpbmc8L0xvYWRlcj5cbiAgICAgICAge2xpc3R9XG4gICAgPC9kaXY+XG4gIH1cbn1cbiIsImltcG9ydCBlbGVtZW50IGZyb20gJ3ZpcnR1YWwtZWxlbWVudCdcbmltcG9ydCB7QUNUSU9OU30gZnJvbSAnLi4vY29yZS9jb25zdGFudHMnO1xuaW1wb3J0IERpc3BhdGNoZXIgZnJvbSAnLi4vY29yZS9kaXNwYXRjaGVyJztcbmltcG9ydCBEcm9wZG93biBmcm9tICcuL2Ryb3Bkb3duJ1xubGV0IFRvb2xiYXIgPSB7XG4gIGFmdGVyUmVuZGVyKGNvbXBvbmVudCwgZWwpIHtcbiAgICAkKGVsKS5maW5kKFwiLmRyb3Bkb3duXCIpLmRyb3Bkb3duKClcbiAgfSxcbiAgcmVuZGVyKCkge1xuICAgIGxldCBuZXdEb2N1bWVudCA9ICgpID0+IERpc3BhdGNoZXIuZGlzcGF0Y2hBY3Rpb24oQUNUSU9OUy5DUkVBVEVfRE9DVU1FTlQpXG4gICAgbGV0IHJlbW92ZURvY3VtZW50ID0gKCkgPT4gRGlzcGF0Y2hlci5kaXNwYXRjaEFjdGlvbihBQ1RJT05TLlJFTU9WRV9ET0NVTUVOVClcbiAgICBsZXQgc2F2ZURvY3VtZW50ID0gKCkgPT4gRGlzcGF0Y2hlci5kaXNwYXRjaEFjdGlvbihBQ1RJT05TLlNBVkVfRE9DVU1FTlQpXG4gICAgbGV0IHByZXZpZXdEb2N1bWVudCA9ICgpID0+IERpc3BhdGNoZXIuZGlzcGF0Y2hBY3Rpb24oQUNUSU9OUy5QUkVWSUVXX0RPQ1VNRU5UKVxuICAgIGxldCBmdWxsU2NyZWVuRG9jdW1lbnQgPSAoKSA9PiBEaXNwYXRjaGVyLmRpc3BhdGNoQWN0aW9uKEFDVElPTlMuRlVMTFNDUkVFTl9ET0NVTUVOVClcbiAgICBcbiAgICByZXR1cm4gPGRpdiBpZD1cInRvb2xiYXJcIiBjbGFzcz1cInVpIHN0YWNraW5nIGljb24gYmFzaWMgYnV0dG9uc1wiPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cInVpIGJ1dHRvblwiIG9uQ2xpY2s9e25ld0RvY3VtZW50fT5cbiAgICAgICAgPGkgY2xhc3M9XCJwbHVzIGljb25cIj48L2k+XG4gICAgICA8L2J1dHRvbj5cbiAgICAgIDxidXR0b24gY2xhc3M9XCJ1aSBidXR0b25cIiBvbkNsaWNrPXtyZW1vdmVEb2N1bWVudH0+PGkgY2xhc3M9XCJ0cmFzaCBpY29uXCI+PC9pPjwvYnV0dG9uPlxuICAgICAgPGJ1dHRvbiBjbGFzcz1cInVpIGJ1dHRvblwiIG9uQ2xpY2s9e3NhdmVEb2N1bWVudH0+PGkgY2xhc3M9XCJzYXZlIGljb25cIj48L2k+PC9idXR0b24+XG4gICAgICA8YnV0dG9uIGNsYXNzPVwidWkgYnV0dG9uXCIgb25DbGljaz17cHJldmlld0RvY3VtZW50fT48aSBjbGFzcz1cInByZXZpZXcgaWNvblwiPjwvaT48L2J1dHRvbj5cbiAgICAgIDxidXR0b24gY2xhc3M9XCJ1aSBidXR0b25cIiBvbkNsaWNrPXtmdWxsU2NyZWVuRG9jdW1lbnR9PjxpIGNsYXNzPVwiZnVsbCBzY3JlZW4gaWNvblwiPjwvaT48L2J1dHRvbj5cbiAgICAgIDxkaXYgY2xhc3M9XCJ1aSBkcm9wZG93biBidXR0b25cIj5cbiAgICAgICAgPGRpdiBjbGFzcz1cInRleHRcIj5TZXR0aW5nczwvZGl2PlxuICAgICAgICA8aSBjbGFzcz1cImRyb3Bkb3duIGljb25cIj48L2k+XG4gICAgICAgIDxEcm9wZG93biBuYW1lPVwiU2V0dGluZ3NcIiBpdGVtcz17W1xuICAgICAgICAgIHsgbmFtZTogXCJJbXBvcnRcIiwgaWNvbjogXCJpbXBvcnRcIiwgZGVzY3JpcHRpb246XCJJbXBvcnQgZG9jdW1lbnRzXCIsIG9uQ2xpY2s6ICgpID0+IERpc3BhdGNoZXIuZGlzcGF0Y2goeyBhY3Rpb25UeXBlOiBBQ1RJT05TLk9QRU5fSU1QT1JUIH0pIH0sXG4gICAgICAgICAgeyBuYW1lOiBcIkxvZ291dFwiLCBpY29uOiBcInNpZ24gb3V0XCIsIGRlc2NyaXB0aW9uOlwiR28gYmFjayB0byBsb2dpblwiLCBvbkNsaWNrOiAoKSA9PiBEaXNwYXRjaGVyLmRpc3BhdGNoKHsgYWN0aW9uVHlwZTogQUNUSU9OUy5TRVRfUk9VVEUsIHJvdXRlOiAnL2xvZ291dCcgfSkgfSxcbiAgICAgICAgXX0gLz5cbiAgICAgIDwvZGl2PlxuICAgIDwvZGl2PlxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IFRvb2xiYXJcbiIsImltcG9ydCBlbGVtZW50IGZyb20gJ3ZpcnR1YWwtZWxlbWVudCdcbmltcG9ydCB7QUNUSU9OU30gZnJvbSAnLi4vY29yZS9jb25zdGFudHMnO1xuaW1wb3J0IERpc3BhdGNoZXIgZnJvbSAnLi4vY29yZS9kaXNwYXRjaGVyJztcblxubGV0IERyb3Bkb3duID0ge1xuXG4gIGFmdGVyUmVuZGVyKGNvbXBvbmVudCwgZWwpIHtcbiAgICAkKGVsKS5kcm9wZG93bigpXG4gIH0sXG5cbiAgcmVuZGVyKGNvbXBvbmVudCkge1xuICAgIGxldCB7IHN0YXRlLCBwcm9wcyB9ID0gY29tcG9uZW50XG4gICAgbGV0IHtcbiAgICAgIGl0ZW1zID0gW11cbiAgICB9ID0gcHJvcHNcblxuICAgIGxldCBuZXdEb2N1bWVudCA9ICgpID0+IERpc3BhdGNoZXIuZGlzcGF0Y2goe1xuICAgICAgYWN0aW9uVHlwZTogQUNUSU9OUy5DUkVBVEVfRE9DVU1FTlQsXG4gICAgfSlcblxuICAgIGl0ZW1zID0gaXRlbXMubWFwKGNoaWxkID0+IHtcbiAgICAgIHJldHVybiA8ZGl2IGNsYXNzPVwiaXRlbVwiIG9uQ2xpY2s9e2NoaWxkLm9uQ2xpY2t9PlxuICAgICAgICB7ICEgY2hpbGQuaWNvbiAgICAgICAgPyAnJyA6IDxpIGNsYXNzPXtgJHtjaGlsZC5pY29ufSBpY29uYH0+PC9pPiB9XG4gICAgICAgIHsgISBjaGlsZC5kZXNjcmlwdGlvbiA/ICcnIDogPHNwYW4gY2xhc3M9XCJkZXNjcmlwdGlvblwiPntjaGlsZC5kZXNjcmlwdGlvbn08L3NwYW4+IH1cbiAgICAgICAge2NoaWxkLm5hbWV9XG4gICAgICA8L2Rpdj5cbiAgICB9KVxuXG5cbiAgICByZXR1cm4gPGRpdiBjbGFzcz1cIm1lbnVcIj5cbiAgICAgICAge2l0ZW1zfVxuICAgIDwvZGl2PlxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IERyb3Bkb3duXG4iLCJpbXBvcnQgZWxlbWVudCBmcm9tICd2aXJ0dWFsLWVsZW1lbnQnXG5cbmxldCBnaHN0eWxlID0gYFxuICBwb3NpdGlvbjogYWJzb2x1dGU7XG4gIHRvcDogMHB4O1xuICBsZWZ0OiAwcHg7XG5gXG5sZXQgZ2hmb3Jrc3JjID0gXCJodHRwczovL2NhbW8uZ2l0aHVidXNlcmNvbnRlbnQuY29tL2M2Mjg2YWRlNzE1ZTliZWE0MzNiNDcwNTg3MGRlNDgyYTY1NGY3OGEvNjg3NDc0NzA3MzNhMmYyZjczMzMyZTYxNmQ2MTdhNmY2ZTYxNzc3MzJlNjM2ZjZkMmY2NzY5NzQ2ODc1NjIyZjcyNjk2MjYyNmY2ZTczMmY2NjZmNzI2YjZkNjU1ZjZjNjU2Njc0NWY3NzY4Njk3NDY1NWY2NjY2NjY2NjY2NjYyZTcwNmU2N1wiXG5sZXQgY2Fub25pY2Fsd3RmID0gXCJodHRwczovL3MzLmFtYXpvbmF3cy5jb20vZ2l0aHViL3JpYmJvbnMvZm9ya21lX2xlZnRfd2hpdGVfZmZmZmZmLnBuZ1wiXG5cbmxldCBGb3JrbWUgPSB7XG4gIHJlbmRlcjogKHtwcm9wc30pID0+XG4gICAgPGEgaHJlZj17YGh0dHBzOi8vZ2l0aHViLmNvbS8ke3Byb3BzLnJlcG99YH0gc3R5bGU9e2doc3R5bGV9ID5cbiAgICAgIDxpbWcgc3JjPXtnaGZvcmtzcmN9IGFsdD1cIkZvcmsgbWUgb24gR2l0SHViXCIgZGF0YS1jYW5vbmljYWwtc3JjPXtjYW5vbmljYWx3dGZ9IC8+XG4gICAgPC9hPlxufVxuZXhwb3J0IGRlZmF1bHQgRm9ya21lXG4iLCJpbXBvcnQgZWxlbWVudCBmcm9tICd2aXJ0dWFsLWVsZW1lbnQnXG5pbXBvcnQge0FDVElPTlN9IGZyb20gJy4uL2NvcmUvY29uc3RhbnRzJztcbmltcG9ydCBEaXNwYXRjaGVyIGZyb20gJy4uL2NvcmUvZGlzcGF0Y2hlcic7XG5cbmxldCBEcm9wZG93biA9IHtcblxuICBhZnRlck1vdW50KGNvbXBvbmVudCwgZWwsIHNldFN0YXRlKSB7XG4gICAgRGlzcGF0Y2hlci5vbkFjdGlvbihBQ1RJT05TLk9QRU5fSU1QT1JULCAoKSA9PiAkKGVsKS5tb2RhbCgnc2hvdycpKVxuICB9LFxuXG4gIHJlbmRlcihjb21wb25lbnQpIHtcbiAgICBsZXQgeyBzdGF0ZSwgcHJvcHMgfSA9IGNvbXBvbmVudFxuXG4gICAgbGV0IG9uQ2hhbmdlRmllbGQgPSBuYW1lID0+IChlLCBjLCBzZXRTdGF0ZSkgPT4ge1xuICAgICAgc2V0U3RhdGUoe1xuICAgICAgICBbbmFtZV06IGUudGFyZ2V0LnZhbHVlXG4gICAgICB9KVxuICAgIH1cblxuICAgIGxldCBzdWJtaXQgPSAoKSA9PiB7XG4gICAgICBhbGVydChzdGF0ZS51cmwpXG4gICAgfVxuXG4gICAgcmV0dXJuIDxkaXYgY2xhc3M9XCJ1aSBiYXNpYyBtb2RhbFwiPlxuICAgICAgPGkgY2xhc3M9XCJjbG9zZSBpY29uXCI+PC9pPlxuICAgICAgPGRpdiBjbGFzcz1cImhlYWRlclwiPlxuICAgICAgICBBcmNoaXZlIE9sZCBNZXNzYWdlc1xuICAgICAgPC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiY29udGVudFwiPlxuICAgICAgPGRpdiBjbGFzcz1cInVpIGZvcm1cIj5cbiAgICAgICAgPGg0IGNsYXNzPVwidWkgZGl2aWRpbmcgaGVhZGVyXCI+R2l2ZSB1cyB5b3VyIGZlZWRiYWNrPC9oND5cbiAgICAgICAgPGRpdiBjbGFzcz1cImZpZWxkXCI+XG4gICAgICAgICAgPGxhYmVsPlVSTDwvbGFiZWw+XG4gICAgICAgICAgPGlucHV0IHR5cGU9XCJ0ZXh0XCIgb25DaGFuZ2U9e29uQ2hhbmdlRmllbGQoXCJ1cmxcIil9IC8+XG4gICAgICAgIDwvZGl2PlxuICAgICAgPC9kaXY+XG4gICAgPC9kaXY+XG4gICAgICA8ZGl2IGNsYXNzPVwiYWN0aW9uc1wiPlxuICAgICAgICA8ZGl2IGNsYXNzPVwidHdvIGZsdWlkIHVpIGludmVydGVkIGJ1dHRvbnNcIj5cbiAgICAgICAgICA8ZGl2IGNsYXNzPVwidWkgZ3JlZW4gYmFzaWMgaW52ZXJ0ZWQgYnV0dG9uXCIgb25DbGljaz17c3VibWl0fT5cbiAgICAgICAgICAgIDxpIGNsYXNzPVwiY2hlY2ttYXJrIGljb25cIj48L2k+XG4gICAgICAgICAgICBZZXNcbiAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgPC9kaXY+XG4gICAgICA8L2Rpdj5cbiAgICA8L2Rpdj5cbiAgfVxufVxuXG5leHBvcnQgZGVmYXVsdCBEcm9wZG93blxuIiwiaW1wb3J0IHsgcmVuZGVyLCB0cmVlIH0gZnJvbSAnZGVrdSdcbmltcG9ydCBlbGVtZW50IGZyb20gJ3ZpcnR1YWwtZWxlbWVudCdcblxuaW1wb3J0IEZvcmttZSBmcm9tICcuL2ZvcmttZSdcbmltcG9ydCBBcHBWaWV3IGZyb20gJy4vYXBwLXZpZXcnXG5pbXBvcnQgeyBBQ1RJT05TIH0gZnJvbSAnLi4vY29yZS9jb25zdGFudHMnXG5pbXBvcnQgRGlzcGF0Y2hlciBmcm9tICcuLi9jb3JlL2Rpc3BhdGNoZXInXG5cbmxldCBMYXlvdXQgPSB7XG4gIGluaXRpYWxTdGF0ZTogKCkgPT4gKHtcbiAgICB2aWV3OiBBcHBWaWV3XG4gIH0pLFxuICBhZnRlck1vdW50OiAoYywgZWwsIHVwZGF0ZSkgPT4ge1xuICAgIERpc3BhdGNoZXIub25BY3Rpb24oQUNUSU9OUy5TRVRfVklFVywgICh7dmlld30pID0+IHVwZGF0ZSh7J3ZpZXcnOiB2aWV3fSkpXG4gIH0sXG4gIHJlbmRlcjogYyA9PiB7XG4gICAgbGV0IFZpZXcgPSBjLnN0YXRlLnZpZXdcbiAgICByZXR1cm4gPG1haW4+XG4gICAgICA8Rm9ya21lIHJlcG89XCJkczBudC9tZHBhZFwiIC8+XG4gICAgICAgIDxWaWV3IC8+XG4gICAgPC9tYWluPlxuICB9XG59XG5cbmxldCBpbml0ID0gKCkgPT4ge1xuICByZW5kZXIodHJlZSg8TGF5b3V0IC8+KSwgZG9jdW1lbnQuZ2V0RWxlbWVudEJ5SWQoJ2FwcCcpKVxufVxuXG5leHBvcnQgZGVmYXVsdCB7XG4gIExheW91dCxcbiAgaW5pdFxufVxuIiwiaW1wb3J0IGVsZW1lbnQgZnJvbSAndmlydHVhbC1lbGVtZW50J1xuaW1wb3J0IEF1dGhTdG9yZSBmcm9tICcuLi9zdG9yZXMvYXV0aCdcbmltcG9ydCBEaXNwYXRjaGVyIGZyb20gJy4uL2NvcmUvZGlzcGF0Y2hlcidcbmltcG9ydCB7IEFDVElPTlMgfSBmcm9tICcuLi9jb3JlL2NvbnN0YW50cydcblxuXG5cbmxldCBpbml0aWFsU3RhdGUgPSAoKSA9PiB7XG4gIHJldHVybiB7XG4gICAgZW1haWwgICA6ICcnLFxuICAgIHBhc3N3b3JkICAgOiAnJyxcbiAgICBzdWJtaXR0aW5nIDogZmFsc2UsXG4gICAgZXJyb3IgICAgICA6ICcnXG4gIH1cbn1cbmxldCBhZnRlck1vdW50ID0gKGMsIGVsLCBzZXRTdGF0ZSkgPT4ge1xuICBzZXRTdGF0ZSh7XG4gICAgbG9naW5IYW5kbGVyOiBBdXRoU3RvcmUub25BY3Rpb24oJ2xvZ2luOmZhaWx1cmUnLCAoe2Vycm9yfSkgPT4ge1xuICAgICAgc2V0U3RhdGUoe1xuICAgICAgICBzdWJtaXR0aW5nIDogZmFsc2UsXG4gICAgICAgIGVycm9yICAgICAgOiBlcnJvclxuICAgICAgfSlcbiAgICB9KVxuXG4gIH0pXG59XG5cbmxldCBiZWZvcmVVbm1vdW50ID0gKGNvbXBvbmVudCkgPT4ge1xuICBsZXQge3N0YXRlfSA9IGNvbXBvbmVudFxuICBzdGF0ZS5sb2dpbkhhbmRsZXIub2ZmKClcbn1cblxubGV0IHJlbmRlciA9IGMgPT4ge1xuICBsZXQgeyBzdGF0ZSwgcHJvcHMgfSA9IGNcbiAgbGV0IGJ1dHRvbkNvbnRlbnQgPSAnTG9naW4nXG4gIGlmICggc3RhdGUuc3VibWl0dGluZyApIHtcbiAgICBidXR0b25Db250ZW50ID0gKDxpbWcgc3JjPVwiL2ltZy9sb2FkaW5nLmdpZlwiIGFsdD1cIkxvZ2dpbmcgaW4uLi5cIiAvPilcbiAgfVxuXG4gIGxldCBvbkNoYW5nZUZpZWxkID0gbmFtZSA9PiAoZSwgYywgc2V0U3RhdGUpID0+IHtcbiAgICBzZXRTdGF0ZSh7XG4gICAgICBbbmFtZV06IGUudGFyZ2V0LnZhbHVlXG4gICAgfSlcbiAgfVxuICBmdW5jdGlvbiBzaWdudXAoKSB7XG4gICAgRGlzcGF0Y2hlci5kaXNwYXRjaCh7XG4gICAgICBhY3Rpb25UeXBlOiBBQ1RJT05TLlNFVF9ST1VURSxcbiAgICAgIHJvdXRlOiAnL3JlZ2lzdGVyJ1xuICAgIH0pXG4gIH1cblxuICBmdW5jdGlvbiBoYW5kbGVTdWJtaXQoIGUsIGNvbXBvbmVudCwgc2V0U3RhdGUgKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpXG4gICAgc2V0U3RhdGUoe1xuICAgICAgc3VibWl0dGluZzogdHJ1ZSxcbiAgICAgIGVycm9yOiAnJ1xuICAgIH0pXG4gICAgRGlzcGF0Y2hlci5kaXNwYXRjaCh7XG4gICAgICBhY3Rpb25UeXBlIDogQUNUSU9OUy5MT0dJTixcbiAgICAgIGVtYWlsICAgOiBjb21wb25lbnQuc3RhdGUuZW1haWwsXG4gICAgICBwYXNzd29yZCAgIDogY29tcG9uZW50LnN0YXRlLnBhc3N3b3JkXG4gICAgfSlcbiAgICByZXR1cm4gZmFsc2VcbiAgfVxuXG4gIHJldHVybiAoXG4gIDxkaXYgY2xhc3M9XCJ1aSBmbHVpZCBkb3VibGluZyBncmlkIGNlbnRlcmVkIGNvbnRhaW5lclwiPlxuICAgIDxkaXYgY2xhc3M9XCJyb3dcIj5cbiAgICAgIDxkaXYgY2xhc3M9XCJmb3VyIHdpZGUgY29sdW1uIGxvZ2luLXBhZ2VcIj5cbiAgICAgICAgPGRpdiBjbGFzcz17YHVpICR7c3RhdGUuc3VibWl0dGluZyA/ICdsb2FkaW5nJyA6ICcnfSAke3N0YXRlLmVycm9yICE9PSAnJyA/ICdlcnJvcicgOiAnJ30gZm9ybWB9PlxuICAgICAgICAgIDxmb3JtPlxuICAgICAgICAgICAgPGgyPkxvZ2luPC9oMj5cbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJmaWVsZFwiPlxuICAgICAgICAgICAgICA8bGFiZWw+RS1tYWlsPC9sYWJlbD5cbiAgICAgICAgICAgICAgPGlucHV0IG5hbWU9XCJlbWFpbFwiIHR5cGU9XCJlbWFpbFwiIG9uQ2hhbmdlPXtvbkNoYW5nZUZpZWxkKCdlbWFpbCcpfSB2YWx1ZT17c3RhdGUuZW1haWx9IHBsYWNlaG9sZGVyPVwiam9lQHNjaG1vZS5jb21cIiAvPlxuICAgICAgICAgICAgICA8bGFiZWw+UGFzc3dvcmQ8L2xhYmVsPlxuICAgICAgICAgICAgICA8aW5wdXQgbmFtZT1cInBhc3N3b3JkXCIgdHlwZT1cInBhc3N3b3JkXCIgb25DaGFuZ2U9e29uQ2hhbmdlRmllbGQoJ3Bhc3N3b3JkJyl9IHZhbHVlPXtzdGF0ZS5wYXNzd29yZH0gcGxhY2Vob2xkZXI9XCJQYXNzd29yZFwiIC8+XG4gICAgICAgICAgICA8L2Rpdj5cbiAgICAgICAgICAgIDxidXR0b24gdHlwZT1cImJ1dHRvblwiIG9uQ2xpY2s9e2hhbmRsZVN1Ym1pdH0gY2xhc3M9XCJ1aSBzdWJtaXQgYnV0dG9uXCI+e2J1dHRvbkNvbnRlbnR9PC9idXR0b24+XG4gICAgICAgICAge1xuICAgICAgICAgICAgc3RhdGUuZXJyb3IgIT09ICcnID9cbiAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJ1aSBlcnJvciBtZXNzYWdlXCI+XG4gICAgICAgICAgICAgIDxkaXYgY2xhc3M9XCJoZWFkZXJcIj5Mb2dpbiBFcnJvcjwvZGl2PlxuICAgICAgICAgICAgICA8cD57c3RhdGUuZXJyb3J9PC9wPlxuICAgICAgICAgICAgPC9kaXY+IDogJydcbiAgICAgICAgICB9XG4gICAgICAgICAgPC9mb3JtPlxuICAgICAgICA8L2Rpdj5cbiAgICAgICAgPHAgY2xhc3M9XCJsb2dpbi1zaWdudXAtbGlua1wiPjxhIG9uQ2xpY2s9e3NpZ251cH0+TmVlZCBhbiBhY2NvdW50PzwvYT48L3A+XG4gICAgICA8L2Rpdj5cbiAgICA8L2Rpdj5cbiAgPC9kaXY+XG4gIClcbn1cbmxldCBMb2dpblZpZXcgPSB7XG4gIGluaXRpYWxTdGF0ZSxcbiAgYWZ0ZXJNb3VudCxcbiAgYmVmb3JlVW5tb3VudCxcbiAgcmVuZGVyXG59XG5leHBvcnQgZGVmYXVsdCBMb2dpblZpZXdcbiIsImltcG9ydCBlbGVtZW50IGZyb20gJ3ZpcnR1YWwtZWxlbWVudCdcbmltcG9ydCBBdXRoU3RvcmUgZnJvbSAnLi4vc3RvcmVzL2F1dGgnXG5pbXBvcnQgRGlzcGF0Y2hlciBmcm9tICcuLi9jb3JlL2Rpc3BhdGNoZXInXG5pbXBvcnQgeyBBQ1RJT05TIH0gZnJvbSAnLi4vY29yZS9jb25zdGFudHMnXG5cblxubGV0IGluaXRpYWxTdGF0ZSA9ICgpID0+IHtcbiAgcmV0dXJuIHtcbiAgICBlbWFpbCAgIDogJycsXG4gICAgcGFzc3dvcmQgICA6ICcnLFxuICAgIHBhc3N3b3JkMiAgIDogJycsXG4gICAgc3VibWl0dGluZyA6IGZhbHNlLFxuICAgIGVycm9yICAgICAgOiAnJ1xuICB9XG59XG5sZXQgYWZ0ZXJNb3VudCA9IChjLCBlbCwgc2V0U3RhdGUpID0+IHtcbiAgc2V0U3RhdGUoe1xuICAgIHJlZ2lzdGVySGFuZGxlcjogQXV0aFN0b3JlLm9uQWN0aW9uKCdyZWdpc3RlcjpmYWlsdXJlJywgKHtlcnJvcn0pID0+IHtcbiAgICAgIHNldFN0YXRlKHtcbiAgICAgICAgc3VibWl0dGluZyA6IGZhbHNlLFxuICAgICAgICBlcnJvciAgICAgIDogZXJyb3JcbiAgICAgIH0pXG4gICAgfSlcblxuICB9KVxufVxuXG5sZXQgYmVmb3JlVW5tb3VudCA9IChjb21wb25lbnQpID0+IHtcbiAgbGV0IHtzdGF0ZX0gPSBjb21wb25lbnRcbiAgc3RhdGUucmVnaXN0ZXJIYW5kbGVyLm9mZigpXG59XG5sZXQgcmVuZGVyID0gYyA9PiB7XG4gIGxldCB7IHN0YXRlLCBwcm9wcyB9ID0gY1xuICBsZXQgYnV0dG9uQ29udGVudCA9ICdSZWdpc3RlcidcbiAgaWYgKCBzdGF0ZS5zdWJtaXR0aW5nICkge1xuICAgIGJ1dHRvbkNvbnRlbnQgPSAoPGltZyBzcmM9XCIvaW1nL2xvYWRpbmcuZ2lmXCIgYWx0PVwiTG9nZ2luZyBpbi4uLlwiIC8+KVxuICB9XG5cbiAgbGV0IG9uQ2hhbmdlRmllbGQgPSBuYW1lID0+IChlLCBjLCBzZXRTdGF0ZSkgPT4ge1xuICAgIHNldFN0YXRlKHtcbiAgICAgIFtuYW1lXTogZS50YXJnZXQudmFsdWVcbiAgICB9KVxuICB9XG5cbiAgZnVuY3Rpb24gaGFuZGxlU3VibWl0KGUsIGNvbXBvbmVudCwgc2V0U3RhdGUgKSB7XG4gICAgZS5wcmV2ZW50RGVmYXVsdCgpXG4gICAgbGV0IHtwcm9wcywgc3RhdGV9ID0gY29tcG9uZW50XG4gICAgaWYgKHN0YXRlLnBhc3N3b3JkICE9PSBzdGF0ZS5wYXNzd29yZDIpIHtcbiAgICAgIHNldFN0YXRlKHtcbiAgICAgICAgc3VibWl0dGluZzogZmFsc2UsXG4gICAgICAgIGVycm9yOiAnUGFzc3dvcmRzIGRvIG5vdCBtYXRjaCdcbiAgICAgIH0pXG4gICAgICByZXR1cm5cbiAgICB9XG4gICAgc2V0U3RhdGUoe1xuICAgICAgc3VibWl0dGluZzogdHJ1ZSxcbiAgICAgIGVycm9yOiAnJ1xuICAgIH0pXG4gICAgRGlzcGF0Y2hlci5kaXNwYXRjaCh7XG4gICAgICBhY3Rpb25UeXBlIDogQUNUSU9OUy5SRUdJU1RFUixcbiAgICAgIGVtYWlsICAgOiBzdGF0ZS5lbWFpbCxcbiAgICAgIHBhc3N3b3JkICAgOiBzdGF0ZS5wYXNzd29yZFxuICAgIH0pXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICBmdW5jdGlvbiBsb2dpbigpIHtcbiAgICBEaXNwYXRjaGVyLmRpc3BhdGNoKHtcbiAgICAgIGFjdGlvblR5cGU6IEFDVElPTlMuU0VUX1JPVVRFLFxuICAgICAgcm91dGU6ICcvbG9naW4nXG4gICAgfSlcbiAgfVxuXG4gIHJldHVybiAoXG4gIDxkaXYgY2xhc3M9XCJ1aSBjb250YWluZXJcIj5cbiAgICA8ZGl2IGNsYXNzPVwicmVnaXN0ZXItcGFnZVwiPlxuICAgICAgPGRpdiBjbGFzcz17YHVpICR7c3RhdGUuc3VibWl0dGluZyA/ICdsb2FkaW5nJyA6ICcnfSAke3N0YXRlLmVycm9yICE9PSAnJyA/ICdlcnJvcicgOiAnJ30gZm9ybWB9PlxuICAgICAgICA8Zm9ybT5cbiAgICAgICAgICA8aDI+UmVnaXN0ZXI8L2gyPlxuICAgICAgICAgIDxkaXYgY2xhc3M9XCJmaWVsZFwiPlxuICAgICAgICAgICAgPGxhYmVsPkUtbWFpbDwvbGFiZWw+XG4gICAgICAgICAgICA8aW5wdXQgbmFtZT1cImVtYWlsXCIgdHlwZT1cImVtYWlsXCIgb25DaGFuZ2U9e29uQ2hhbmdlRmllbGQoJ2VtYWlsJyl9IHZhbHVlPXtzdGF0ZS5lbWFpbH0gcGxhY2Vob2xkZXI9XCJqb2VAc2NobW9lLmNvbVwiIC8+XG4gICAgICAgICAgICA8bGFiZWw+UGFzc3dvcmQ8L2xhYmVsPlxuICAgICAgICAgICAgPGlucHV0IG5hbWU9XCJwYXNzd29yZFwiIHR5cGU9XCJwYXNzd29yZFwiIG9uQ2hhbmdlPXtvbkNoYW5nZUZpZWxkKCdwYXNzd29yZCcpfSB2YWx1ZT17c3RhdGUucGFzc3dvcmR9IHBsYWNlaG9sZGVyPVwiUGFzc3dvcmRcIiAvPlxuICAgICAgICAgICAgPGxhYmVsPkNvbmZpcm0gUGFzc3dvcmQ8L2xhYmVsPlxuICAgICAgICAgICAgPGlucHV0IG5hbWU9XCJwYXNzd29yZDJcIiB0eXBlPVwicGFzc3dvcmRcIiBvbkNoYW5nZT17b25DaGFuZ2VGaWVsZCgncGFzc3dvcmQyJyl9IHZhbHVlPXtzdGF0ZS5wYXNzd29yZDJ9IHBsYWNlaG9sZGVyPVwiQ29uZmlybSBQYXNzd29yZFwiIC8+XG4gICAgICAgICAgPC9kaXY+XG4gICAgICAgICAgPGJ1dHRvbiB0eXBlPVwiYnV0dG9uXCIgb25DbGljaz17aGFuZGxlU3VibWl0fSBjbGFzcz1cInVpIHN1Ym1pdCBidXR0b25cIj57YnV0dG9uQ29udGVudH08L2J1dHRvbj5cbiAgICAgICAgICB7XG4gICAgICAgICAgICBzdGF0ZS5lcnJvciAhPT0gJycgP1xuICAgICAgICAgICAgPGRpdiBjbGFzcz1cInVpIGVycm9yIG1lc3NhZ2VcIj5cbiAgICAgICAgICAgICAgPGRpdiBjbGFzcz1cImhlYWRlclwiPlJlZ2lzdGF0aW9uIEVycm9yPC9kaXY+XG4gICAgICAgICAgICAgIDxwPntzdGF0ZS5lcnJvcn08L3A+XG4gICAgICAgICAgICA8L2Rpdj4gOiAnJ1xuICAgICAgICAgIH1cbiAgICAgICAgPC9mb3JtPlxuICAgICAgPC9kaXY+XG4gICAgICA8cCBjbGFzcz1cInJlZ2lzdGVyLXNpZ251cC1saW5rXCI+XG4gICAgICAgIDxhIG9uQ2xpY2s9e2xvZ2lufT5BbHJlYWR5IGhhdmUgYW4gYWNjb3VudD88L2E+XG4gICAgICA8L3A+XG4gICAgPC9kaXY+XG4gIDwvZGl2PlxuICApXG59XG5sZXQgTG9naW5WaWV3ID0ge1xuICBpbml0aWFsU3RhdGUsXG4gIGFmdGVyTW91bnQsXG4gIGJlZm9yZVVubW91bnQsXG4gIHJlbmRlclxufVxuZXhwb3J0IGRlZmF1bHQgTG9naW5WaWV3XG4iLCJpbXBvcnQgRmx1eCBmcm9tICdmbHV4JztcblxuZnVuY3Rpb24gc3RhY2tGcm9tKCkge1xuICAgIHZhciBlcnIgPSBuZXcgRXJyb3IoKTtcbiAgICByZXR1cm4gd2luZG93LnByaW50RnJvbSA/IGVyci5zdGFjay5zcGxpdCgnXFxuJylbM10gOiBcIlwiXG59XG5cbmNsYXNzIERpc3BhdGNoZXIgZXh0ZW5kcyBGbHV4LkRpc3BhdGNoZXIge1xuICBkaXNwYXRjaEFjdGlvbihhY3Rpb25UeXBlLCBkYXRhKSB7XG4gICAgY29uc29sZS5sb2coXCJEaXNwYXRjaGluZ1wiLCBhY3Rpb25UeXBlLCBKU09OLnN0cmluZ2lmeShkYXRhLCBmYWxzZSwgNCksIHN0YWNrRnJvbSgpKVxuICAgIHRoaXMuZGlzcGF0Y2goe1xuICAgICAgYWN0aW9uVHlwZSxcbiAgICAgIC4uLih0eXBlb2YgZGF0YSAhPT0gJ3VuZGVmaW5lZCcgPyBkYXRhIDoge30pXG4gICAgfSlcbiAgfVxuICBvbkFjdGlvbih0eXBlLCBjYWxsYmFjaykge1xuICAgIGNvbnNvbGUubG9nKFwiUmVnaXN0ZXJlZCBoYW5kbGVyXCIsIHR5cGUsIHN0YWNrRnJvbSgpKVxuICAgIGxldCBpZCA9IHRoaXMucmVnaXN0ZXIoKHsgYWN0aW9uVHlwZSwgLi4uZGF0YSB9KSA9PiB7XG4gICAgICBpZiAodHlwZSA9PSBhY3Rpb25UeXBlKSB7XG4gICAgICAgIGNvbnNvbGUubG9nKFwiRmlyaW5nIGhhbmRsZXIgZm9yIFwiLCB0eXBlLCBzdGFja0Zyb20oKSlcbiAgICAgICAgY2FsbGJhY2soZGF0YSlcbiAgICAgIH1cbiAgICB9KVxuICAgIHJldHVybiB7XG4gICAgICBvZmY6ICgpID0+IHtcbiAgICAgICAgY29uc29sZS5sb2coXCJVbnJlZ2lzdGVyXCIsIHR5cGUsIHN0YWNrRnJvbSgpKVxuICAgICAgICB0aGlzLnVucmVnaXN0ZXIoaWQpXG4gICAgICB9XG4gICAgfVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IERpc3BhdGNoZXJcbiIsImltcG9ydCB7IFJvdXRlciB9IGZyb20gJ2RpcmVjdG9yJ1xuaW1wb3J0IEF1dGhTdG9yZSBmcm9tICcuLi9zdG9yZXMvYXV0aCdcbmltcG9ydCBMYXlvdXQgZnJvbSAnLi4vY29tcG9uZW50cy9sYXlvdXQnXG5pbXBvcnQgeyBBQ1RJT05TIH0gZnJvbSAnLi4vY29yZS9jb25zdGFudHMnXG5pbXBvcnQgQXBwVmlldyBmcm9tICcuLi9jb21wb25lbnRzL2FwcC12aWV3J1xuaW1wb3J0IExvZ2luVmlldyBmcm9tICcuLi9jb21wb25lbnRzL2xvZ2luLXZpZXcnXG5pbXBvcnQgUmVnaXN0ZXJWaWV3IGZyb20gJy4uL2NvbXBvbmVudHMvcmVnaXN0ZXItdmlldydcbmltcG9ydCBEaXNwYXRjaGVyIGZyb20gJy4uL2NvcmUvZGlzcGF0Y2hlcidcblxuY2xhc3MgQXBwbGljYXRpb24ge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBMYXlvdXQuaW5pdCgpXG4gICAgdGhpcy5yb3V0ZXIgPSBSb3V0ZXIoe1xuICAgICAgJy8nOiBbdGhpcy5hdXRoZWQsIHRoaXMuYXBwXSxcbiAgICAgICcvbG9naW4nOiBbdGhpcy51bmF1dGhlZCwgdGhpcy5sb2dpbl0sXG4gICAgICAnL3JlZ2lzdGVyJzogW3RoaXMudW5hdXRoZWQsIHRoaXMucmVnaXN0ZXJdLFxuICAgICAgJy9sb2dvdXQnOiBbdGhpcy5hdXRoZWQsIHRoaXMubG9nb3V0XSxcbiAgICB9KVxuICAgIHRoaXMucm91dGVyLmluaXQoKVxuICAgIGxldCByb3V0ZSA9IHdpbmRvdy5sb2NhdGlvbi5oYXNoLnNsaWNlKDIpXG4gICAgdGhpcy5yb3V0ZXIuc2V0Um91dGUocm91dGUpXG4gICAgRGlzcGF0Y2hlci5vbkFjdGlvbihBQ1RJT05TLlNFVF9ST1VURSwgKGRhdGEpID0+IHRoaXMucm91dGVyLnNldFJvdXRlKGRhdGEucm91dGUpKVxuICAgIEF1dGhTdG9yZS5vbkFjdGlvbigndXBkYXRlJywgKHN0YXRlKSA9PiB0aGlzLnJvdXRlci5zZXRSb3V0ZSggc3RhdGUudG9rZW4gPyAnLycgOiAnL2xvZ2luJykgKVxuICB9XG5cbiAgc3RhcnQoKSB7XG4gIH1cblxuICBhdXRoZWQoKSB7XG4gICAgaWYgKCFBdXRoU3RvcmUuaXNBdXRoZW50aWNhdGVkKCkpIHtcbiAgICAgIGNvbnNvbGUubG9nKFwiVW5BdXRoZWQ6IHJlZGlyZWN0aW5nIHRvIC9sb2dpblwiKTtcbiAgICAgIHRoaXMuc2V0Um91dGUoJy9sb2dpbicpXG4gICAgfVxuICB9XG5cbiAgdW5hdXRoZWQoKSB7XG4gICAgaWYgKEF1dGhTdG9yZS5pc0F1dGhlbnRpY2F0ZWQoKSkge1xuICAgICAgRGlzcGF0Y2hlci5kaXNwYXRjaCh7XG4gICAgICAgIGFjdGlvblR5cGU6IEFDVElPTlMuTE9HT1VUXG4gICAgICB9KVxuICAgIH1cbiAgfVxuXG4gIGFwcCgpIHtcbiAgICBEaXNwYXRjaGVyLmRpc3BhdGNoKHtcbiAgICAgIGFjdGlvblR5cGU6IEFDVElPTlMuU1lOQ19ET0NVTUVOVFNcbiAgICB9KVxuICAgIERpc3BhdGNoZXIuZGlzcGF0Y2goe1xuICAgICAgYWN0aW9uVHlwZSA6IEFDVElPTlMuU0VUX1ZJRVcsXG4gICAgICB2aWV3ICAgOiBBcHBWaWV3XG4gICAgfSlcbiAgfVxuXG4gIGxvZ2luKCkge1xuICAgIERpc3BhdGNoZXIuZGlzcGF0Y2goe1xuICAgICAgYWN0aW9uVHlwZSA6IEFDVElPTlMuU0VUX1ZJRVcsXG4gICAgICB2aWV3ICAgOiBMb2dpblZpZXdcbiAgICB9KVxuICB9XG4gIGxvZ291dCgpIHtcbiAgICBEaXNwYXRjaGVyLmRpc3BhdGNoKHtcbiAgICAgIGFjdGlvblR5cGU6IEFDVElPTlMuTE9HT1VUXG4gICAgfSlcbiAgfVxuXG4gIHJlZ2lzdGVyKCkge1xuICAgIERpc3BhdGNoZXIuZGlzcGF0Y2goe1xuICAgICAgYWN0aW9uVHlwZSA6IEFDVElPTlMuU0VUX1ZJRVcsXG4gICAgICB2aWV3ICAgOiBSZWdpc3RlclZpZXdcbiAgICB9KVxuICB9XG59XG5cbmV4cG9ydCBkZWZhdWx0IG5ldyBBcHBsaWNhdGlvblxuIiwibW9kdWxlLmV4cG9ydHMgPSB7XG4gIEFQSV9VUkwgICAgICAgOiAnaHR0cDovL2xvY2FsaG9zdDo1MDAwJyxcbiAgQVVUSF9EQVRBX0tFWSA6ICdhdXRoRGF0YScsXG4gIEFDVElPTlMgICAgICAgOiB7XG4gICAgU0VUX1ZJRVcgICAgICAgICA6ICdzZXRfdmlldycsXG4gICAgU0VUX1JPVVRFICAgICAgICA6ICdzZXRfcm91dGUnLFxuICAgIExPR0lOICAgICAgICAgICAgOiAnbG9naW4nLFxuICAgIExPR09VVCAgICAgICAgICAgOiAnbG9nb3V0JyxcbiAgICBSRUdJU1RFUiAgICAgICAgICAgOiAncmVnaXN0ZXInLFxuICAgIFNZTkNfRE9DVU1FTlRTICAgOiAnc3luY19kb2N1bWVudHMnLFxuICAgIENSRUFURV9ET0NVTUVOVCAgOiAnY3JlYXRlX2RvY3VtZW50JyxcbiAgICBTQVZFX0RPQ1VNRU5UICA6ICdzYXZlX2RvY3VtZW50JyxcbiAgICBSRU1PVkVfRE9DVU1FTlQgIDogJ3JlbW92ZV9kb2N1bWVudCcsXG4gICAgU0VMRUNUX0RPQ1VNRU5UICA6ICdzZWxlY3RfZG9jdW1lbnQnLFxuICAgIEFSQ0hJVkVfRE9DVU1FTlQgOiAnYXJjaGl2ZV9kb2N1bWVudCcsXG4gICAgT1BFTl9JTVBPUlQgOiAnb3Blbl9pbXBvcnQnLFxuICAgIFBSRVZJRVdfRE9DVU1FTlQgOiAncHJldmlld19kb2N1bWVudCcsXG4gICAgRlVMTFNDUkVFTl9ET0NVTUVOVCAgOiAnZnVsbHNjcmVlbl9kb2N1bWVudCAnLFxuICB9LFxufTtcbiIsImltcG9ydCBBY3Rpb25EaXNwYXRjaGVyIGZyb20gJy4vYWN0aW9uLWRpc3BhdGNoZXInXG5cbmV4cG9ydCBkZWZhdWx0IG5ldyBBY3Rpb25EaXNwYXRjaGVyKClcbiIsImV4cG9ydCBjbGFzcyBOZXR3b3JrRXJyb3IgZXh0ZW5kcyBFcnJvciB7XG4gIGNvbnN0cnVjdG9yKCBzdGF0dXNDb2RlLCBtZXNzYWdlICkge1xuICAgIHN1cGVyKClcbiAgICB0aGlzLm5hbWUgICAgICAgPSAnTmV0d29ya0Vycm9yJ1xuICAgIHRoaXMubWVzc2FnZSAgICA9IG1lc3NhZ2UgfHwgJ1Vua25vd24gSFRUUCBFcnJvcidcbiAgICB0aGlzLnN0YXR1c0NvZGUgPSBzdGF0dXNDb2RlIHx8IDUwMFxuICAgIHRoaXMuc3RhY2sgICAgICA9IChuZXcgRXJyb3IoKSkuc3RhY2tcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgQmFkUmVxdWVzdEVycm9yIGV4dGVuZHMgTmV0d29ya0Vycm9yIHtcbiAgY29uc3RydWN0b3IoIGRldGFpbHMgKSB7XG4gICAgc3VwZXIoIDQwMCwgJ0JhZCBSZXF1ZXN0JyApXG4gICAgdGhpcy5uYW1lICAgID0gJ0JhZFJlcXVlc3RFcnJvcidcbiAgICB0aGlzLmRldGFpbHMgPSBkZXRhaWxzXG4gIH1cbn1cblxuZXhwb3J0IGNsYXNzIFVuYXV0aG9yaXplZEVycm9yIGV4dGVuZHMgTmV0d29ya0Vycm9yIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoIDQwMSwgJ1VuYXV0aG9yaXplZCcgKVxuICAgIHRoaXMubmFtZSA9ICdVbmF1dGhvcml6ZWRFcnJvcidcbiAgfVxufVxuXG5leHBvcnQgY2xhc3MgRm9yYmlkZGVuRXJyb3IgZXh0ZW5kcyBOZXR3b3JrRXJyb3Ige1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlciggNDAzLCAnRm9yYmlkZGVuJyApXG4gICAgdGhpcy5uYW1lID0gJ0ZvcmJpZGRlbkVycm9yJ1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBOb3RGb3VuZEVycm9yIGV4dGVuZHMgTmV0d29ya0Vycm9yIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoIDQwNCwgJ05vdCBGb3VuZCcgKVxuICAgIHRoaXMubmFtZSA9ICdOb3RGb3VuZEVycm9yJ1xuICB9XG59XG5cbmV4cG9ydCBjbGFzcyBNZXRob2ROb3RBbGxvd2VkRXJyb3IgZXh0ZW5kcyBOZXR3b3JrRXJyb3Ige1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlciggNDA1LCAnTWV0aG9kIE5vdCBBbGxvd2VkJyApXG4gICAgdGhpcy5uYW1lID0gJ01ldGhvZE5vdEFsbG93ZWRFcnJvcidcbiAgfVxufVxuZXhwb3J0IGNsYXNzIENvbmZsaWN0RXJyb3IgZXh0ZW5kcyBOZXR3b3JrRXJyb3Ige1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlciggNDA5LCAnQ29uZmxpY3QnIClcbiAgICB0aGlzLm5hbWUgPSAnQ29uZmxpY3RFcnJvcidcbiAgfVxufVxuXG5leHBvcnQgZnVuY3Rpb24gZXJyb3JGcm9tWEhSKCB4aHIgKSB7XG4gIGlmICggeGhyLnN0YXR1cyApIHtcbiAgICBzd2l0Y2ggKCB4aHIuc3RhdHVzICkge1xuICAgICAgY2FzZSA0MDA6XG4gICAgICAgIHJldHVybiBuZXcgQmFkUmVxdWVzdEVycm9yKClcbiAgICAgICAgYnJlYWtcblxuICAgICAgY2FzZSA0MDE6XG4gICAgICAgIHJldHVybiBuZXcgVW5hdXRob3JpemVkRXJyb3IoKVxuICAgICAgICBicmVha1xuXG4gICAgICBjYXNlIDQwMzpcbiAgICAgICAgcmV0dXJuIG5ldyBGb3JiaWRkZW5FcnJvcigpXG4gICAgICAgIGJyZWFrXG5cbiAgICAgIGNhc2UgNDA0OlxuICAgICAgICByZXR1cm4gbmV3IE5vdEZvdW5kRXJyb3IoKVxuICAgICAgICBicmVha1xuXG4gICAgICBjYXNlIDQwNTpcbiAgICAgICAgcmV0dXJuIG5ldyBNZXRob2ROb3RBbGxvd2VkRXJyb3IoKVxuICAgICAgICBicmVha1xuICAgICAgICBcbiAgICAgIGNhc2UgNDA5OlxuICAgICAgICByZXR1cm4gbmV3IENvbmZsaWN0RXJyb3IoKVxuICAgICAgICBicmVha1xuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICByZXR1cm4gbmV3IE5ldHdvcmtFcnJvciggeGhyLnN0YXR1cywgeGhyLnN0YXR1c1RleHQgKVxuICAgICAgICBicmVha1xuICAgIH1cbiAgfSBlbHNlIHtcbiAgICAvLyBOb3QgYW4gWEhSXG4gICAgcmV0dXJuIHhoclxuICB9XG59XG4iLCJpbXBvcnQgeyBBUElfVVJMIH0gZnJvbSAnLi9jb25zdGFudHMnXG5pbXBvcnQgQXV0aFN0b3JlIGZyb20gJy4uL3N0b3Jlcy9hdXRoJ1xuaW1wb3J0IGF4aW9zIGZyb20gJ2F4aW9zJ1xuaW1wb3J0IGFzc2lnbiBmcm9tICdvYmplY3QtYXNzaWduJ1xuaW1wb3J0IHtlcnJvckZyb21YSFJ9IGZyb20gJy4vZXJyb3JzJ1xuXG4vL1xuLy8gSFRUUCBWZXJic1xuLy9cblxubGV0IGlveCA9IG1ldGhvZCA9PlxuICAodXJsLCBvcHRpb25zPXt9KSA9PlxuICAgIChkYXRhKSA9PiB7XG5cbiAgICAgIHJldHVybiBheGlvcyh7XG4gICAgICAgIHVybDogYCR7QVBJX1VSTH0ke3VybH1gLFxuICAgICAgICBkYXRhLFxuICAgICAgICBvcHRpb25zLFxuICAgICAgICBtZXRob2RcbiAgICAgIH0pXG4gIH1cblxuYXhpb3MuaW50ZXJjZXB0b3JzLnJlcXVlc3QudXNlKHJlcSA9PiB7XG4gIGxldCB7IHRva2VuIH0gPSBBdXRoU3RvcmUuZ2V0U3RhdGUoKVxuICBpZiAodG9rZW4pIHtcbiAgICByZXEuaGVhZGVycyA9IHtcbiAgICAgIEF1dGhvcml6YXRpb246IGBUb2tlbiAke3Rva2VufWBcbiAgICB9XG4gIH1cbiAgcmV0dXJuIHJlcVxufSlcbiAgLy8gQWRkIGEgcmVzcG9uc2UgaW50ZXJjZXB0b3JcbmF4aW9zLmludGVyY2VwdG9ycy5yZXNwb25zZS51c2UocmVzID0+IHJlcywgZXJyID0+IFByb21pc2UucmVqZWN0KGVycm9yRnJvbVhIUihlcnIpKSlcblxuZXhwb3J0IGRlZmF1bHQge1xuICBnZXQ6IGlveCgnR0VUJyksXG4gIHBvc3Q6IGlveCgnUE9TVCcpLFxuICBwdXQ6IGlveCgnUFVUJyksXG4gIGRlbGV0ZTogaW94KCdERUxFVEUnKSxcbiAgcGF0Y2g6IGlveCgnUEFUQ0gnKSxcbn1cbiIsImltcG9ydCBBY3Rpb25EaXNwYXRjaGVyIGZyb20gJy4uL2NvcmUvYWN0aW9uLWRpc3BhdGNoZXInXG5cbmltcG9ydCBhc3NpZ24gZnJvbSAnb2JqZWN0LWFzc2lnbidcblxuY2xhc3MgU3RvcmUgZXh0ZW5kcyBBY3Rpb25EaXNwYXRjaGVyIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoKVxuICAgIHRoaXMuX3N0YXRlID0ge31cbiAgICB0aGlzLnNldFN0YXRlKHRoaXMuZ2V0SW5pdGlhbFN0YXRlKCkpXG4gIH1cbiAgZ2V0SW5pdGlhbFN0YXRlKCkge1xuICAgIHJldHVybiB7fVxuICB9XG4gIGdldFN0YXRlKCkge1xuICAgIHJldHVybiB0aGlzLl9zdGF0ZVxuICB9XG4gIHNldFN0YXRlKGFwcGx5U3RhdGUpIHtcbiAgICB0aGlzLl9zdGF0ZSA9IGFzc2lnbih0aGlzLl9zdGF0ZSwgYXBwbHlTdGF0ZSlcbiAgICB0aGlzLmRpc3BhdGNoKHtcbiAgICAgIGFjdGlvblR5cGU6IFwidXBkYXRlXCIsXG4gICAgICAuLi4gdGhpcy5fc3RhdGVcbiAgICB9KVxuICAgIGNvbnNvbGUubG9nKFwic3RhdGVcIiwgdGhpcy5fc3RhdGUpXG4gIH1cbn1cbmV4cG9ydCBkZWZhdWx0IFN0b3JlXG4iLCJpbXBvcnQgaHR0cCBmcm9tICcuLi9jb3JlL2h0dHAnXG5cbmV4cG9ydCBkZWZhdWx0IHtcbiAgbG9naW46IGh0dHAucG9zdCBgL2F1dGgvbG9naW5gLFxuICByZWdpc3RlcjogaHR0cC5wb3N0IGAvYXV0aC9yZWdpc3RlcmAsXG59XG4iLCJpbXBvcnQgaHR0cCBmcm9tICcuLi9jb3JlL2h0dHAnXG5leHBvcnQgZGVmYXVsdCB7XG4gIHN5bmMgICA6IGh0dHAuZ2V0KGAvYXBpL2RvY3VtZW50c2ApLFxuICBmZXRjaCAgOiBpZCA9PiBodHRwLmdldChgL2FwaS9kb2N1bWVudHMvJHtpZH1gKSgpLFxuICBjcmVhdGUgOiBkYXRhID0+IGh0dHAucG9zdChgL2FwaS9kb2N1bWVudHNgKShkYXRhKSxcbiAgdXBkYXRlIDogKGlkLCBkYXRhKSA9PiBodHRwLnB1dChgL2FwaS9kb2N1bWVudHMvJHtpZH1gKShkYXRhKSxcbiAgZGVsZXRlIDogaWQgPT4gaHR0cC5kZWxldGUoYC9hcGkvZG9jdW1lbnRzLyR7aWR9YCkoKSxcbn1cbiIsIi8qKlxuICogQXV0aFN0b3JlXG4gKiBhIHN0b3JlIHRoYXQgdXNlcyBhcGkgY2FsbHMgYW5kIGxvY2FsIHN0b3JhZ2UgdG8gbWFuYWdlIHRva2VuIGJhc2VkIHVzZXIgYXV0aGVudGljYXRpb25cbiAqXG4gKiBkaXNwYXRjaGVzOlxuICpcbiAqIGhhbmRsZXM6XG4gKiAgIEFDVElPTlMuTE9HSU5cbiAqICAgQUNUSU9OUy5MT0dPVVRcbiAqXG4gKiBlbWl0czpcbiAqICAgLSBsb2dpbjpzdWNjZXNzLCBsb2dpbjpmYWlsdXJlLCBsb2dpbjphY3RpdmF0ZVxuICogICAtIGxvZ291dDpzdWNjZXNzXG4gKi9cbmltcG9ydCB7XG4gIEFDVElPTlMsXG4gIEFVVEhfSEVBREVSLFxuICBBVVRIX0RBVEFfS0VZLFxufSBmcm9tICcuLi9jb3JlL2NvbnN0YW50cydcbmltcG9ydCB7XG4gIFVuYXV0aG9yaXplZEVycm9yLFxuICBGb3JiaWRkZW5FcnJvcixcbiAgQ29uZmxpY3RFcnJvcixcbiAgTm90Rm91bmRFcnJvcixcbn0gZnJvbSAnLi4vY29yZS9lcnJvcnMnXG5pbXBvcnQgU3RvcmUgZnJvbSAnLi4vY29yZS9zdG9yZSdcbmltcG9ydCBhdXRoIGZyb20gJy4uL2h0dHAvYXV0aCdcbmltcG9ydCBEaXNwYXRjaGVyIGZyb20gJy4uL2NvcmUvZGlzcGF0Y2hlcidcblxuY2xhc3MgQXV0aFN0b3JlIGV4dGVuZHMgU3RvcmUge1xuICBjb25zdHJ1Y3RvcigpIHtcbiAgICBzdXBlcigpXG4gICAgRGlzcGF0Y2hlci5vbkFjdGlvbihBQ1RJT05TLkxPR0lOLCAoZGF0YSkgPT4gdGhpcy5sb2dpbkFjdGlvbihkYXRhKSlcbiAgICBEaXNwYXRjaGVyLm9uQWN0aW9uKEFDVElPTlMuUkVHSVNURVIsIChkYXRhKSA9PiB0aGlzLnJlZ2lzdGVyQWN0aW9uKGRhdGEpKVxuICAgIERpc3BhdGNoZXIub25BY3Rpb24oQUNUSU9OUy5MT0dPVVQsICgpID0+IHRoaXMubG9nb3V0QWN0aW9uKCkpXG4gIH1cbiAgZ2V0SW5pdGlhbFN0YXRlKCkge1xuICAgIGxldCB7XG4gICAgICB0b2tlbiA9IG51bGwsXG4gICAgICB1c2VyID0gbnVsbCxcbiAgICB9ID0gSlNPTi5wYXJzZSggc2Vzc2lvblN0b3JhZ2UuZ2V0SXRlbShBVVRIX0RBVEFfS0VZKSkgfHwge31cbiAgICByZXR1cm4geyB0b2tlbiwgdXNlciB9XG4gIH1cblxuICBzZXRBdXRoKGRhdGEpIHtcbiAgICB0aGlzLnNldFN0YXRlKHtcbiAgICAgIHRva2VuIDogZGF0YS50b2tlbixcbiAgICAgIHVzZXIgOiBkYXRhLnVzZXIsXG4gICAgfSlcbiAgICBzZXNzaW9uU3RvcmFnZS5zZXRJdGVtKEFVVEhfREFUQV9LRVksIEpTT04uc3RyaW5naWZ5KGRhdGEpKVxuICB9XG5cbiAgY2xlYXJBdXRoKCkge1xuICAgIHRoaXMuc2V0U3RhdGUoe1xuICAgICAgdG9rZW46IG51bGwsXG4gICAgICB1c2VyOiBudWxsLFxuICAgIH0pXG4gICAgc2Vzc2lvblN0b3JhZ2UucmVtb3ZlSXRlbShBVVRIX0RBVEFfS0VZKVxuICB9XG5cbiAgaXNBdXRoZW50aWNhdGVkKCkge1xuICAgIGxldCB7IHRva2VuLCB1c2VyIH0gPSB0aGlzLmdldFN0YXRlKClcbiAgICBjb25zb2xlLmxvZyh0b2tlbiwgdXNlcilcbiAgICBpZiAodG9rZW4gIT0gbnVsbClcbiAgICAgIHJldHVybiB0cnVlXG4gICAgcmV0dXJuIGZhbHNlXG4gIH1cblxuICBhc3luYyBsb2dpbkFjdGlvbihkYXRhKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnNvbGUubG9nKGRhdGEpXG4gICAgICBsZXQgcmVzID0gYXdhaXQgYXV0aC5sb2dpbihkYXRhKVxuICAgICAgdGhpcy5zZXRBdXRoKHtcbiAgICAgICAgdG9rZW46IHJlcy5kYXRhLmFjY2Vzc190b2tlblxuICAgICAgfSlcbiAgICAgIHRoaXMuZGlzcGF0Y2goJ2xvZ2luOnN1Y2Nlc3MnKVxuICAgIH0gY2F0Y2goZSkge1xuICAgICAgaWYgKCBlIGluc3RhbmNlb2YgVW5hdXRob3JpemVkRXJyb3IgKSB7XG4gICAgICAgIHRoaXMuZGlzcGF0Y2goe2FjdGlvblR5cGU6ICdsb2dpbjpmYWlsdXJlJywgZXJyb3I6IFwiSW5jb3JyZWN0IHVzZXJuYW1lIG9yIHBhc3N3b3JkXCIgfSlcbiAgICAgIH0gZWxzZSBpZiAoIGUgaW5zdGFuY2VvZiBGb3JiaWRkZW5FcnJvciApIHtcbiAgICAgICAgdGhpcy5kaXNwYXRjaCh7YWN0aW9uVHlwZTogJ2xvZ2luOmFjdGl2YXRlJ30pXG4gICAgICB9IGVsc2UgaWYgKCBlIGluc3RhbmNlb2YgTm90Rm91bmRFcnJvciApIHtcbiAgICAgICAgdGhpcy5kaXNwYXRjaCh7YWN0aW9uVHlwZTogJ2xvZ2luOmZhaWx1cmUnLCAgZXJyb3I6IFwiSW5jb3JyZWN0IHVzZXJuYW1lIG9yIHBhc3N3b3JkXCIgfSlcbiAgICAgIH0gZWxzZSB7XG4gICAgICB9XG4gICAgICAgIGNvbnNvbGUuZXJyb3IoIGUuc3RhY2sgKVxuICAgIH1cbiAgfVxuICBhc3luYyByZWdpc3RlckFjdGlvbihkYXRhKSB7XG4gICAgdHJ5IHtcbiAgICAgIGNvbnNvbGUubG9nKGRhdGEpXG4gICAgICBsZXQgcmVzID0gYXdhaXQgYXV0aC5yZWdpc3RlcihkYXRhKVxuICAgICAgdGhpcy5zZXRBdXRoKHJlcy5kYXRhKVxuICAgICAgdGhpcy5kaXNwYXRjaCgnbG9naW46c3VjY2VzcycpXG4gICAgfSBjYXRjaChlKSB7XG4gICAgICBpZiAoIGUgaW5zdGFuY2VvZiBDb25mbGljdEVycm9yICkge1xuICAgICAgICB0aGlzLmRpc3BhdGNoKHthY3Rpb25UeXBlOiAncmVnaXN0ZXI6ZmFpbHVyZScsICBlcnJvcjogXCJUaGF0IGFjY291bnQgYWxyZWFkeSBleGlzdHNcIiB9KVxuICAgICAgfSBlbHNlIHtcbiAgICAgICAgdGhpcy5kaXNwYXRjaCh7YWN0aW9uVHlwZTogJ3JlZ2lzdGVyOmZhaWx1cmUnLCBlcnJvcjogZS5FcnJvciB9KVxuICAgICAgfVxuICAgIH1cbiAgfVxuXG5cbiAgbG9nb3V0QWN0aW9uKCkge1xuICAgIHRoaXMuY2xlYXJBdXRoKClcbiAgICB0aGlzLmRpc3BhdGNoKCdsb2dvdXQ6c3VjY2VzcycpXG4gIH1cbn1cbmV4cG9ydCBkZWZhdWx0IG5ldyBBdXRoU3RvcmUoKVxuIiwiLyoqXG4gKiBBdXRoU3RvcmVcbiAqIGEgc3RvcmUgdGhhdCB1c2VzIGFwaSBjYWxscyBhbmQgbG9jYWwgc3RvcmFnZSB0byBtYW5hZ2UgdG9rZW4gYmFzZWQgdXNlciBhdXRoZW50aWNhdGlvblxuICpcbiAqIGRpc3BhdGNoZXM6XG4gKlxuICogaGFuZGxlczpcbiAqICAgQUNUSU9OUy5TWU5DX0RPQ1VNRU5UU1xuICpcbiAqIGVtaXRzOlxuICogICAtIHN5bmM6c3VjY2Vzcywgc3luYzpmYWlsdXJlXG4gKi9cblxuIGltcG9ydCB7IEFDVElPTlMgfSBmcm9tICcuLi9jb3JlL2NvbnN0YW50cydcbmltcG9ydCBTdG9yZSBmcm9tICcuLi9jb3JlL3N0b3JlJ1xuaW1wb3J0IGRvY3VtZW50cyBmcm9tICcuLi9odHRwL2RvY3VtZW50cydcbmltcG9ydCBEaXNwYXRjaGVyIGZyb20gJy4uL2NvcmUvZGlzcGF0Y2hlcidcblxuY2xhc3MgRG9jdW1lbnRTdG9yZSBleHRlbmRzIFN0b3JlIHtcbiAgY29uc3RydWN0b3IoKSB7XG4gICAgc3VwZXIoKVxuICAgIERpc3BhdGNoZXIub25BY3Rpb24oQUNUSU9OUy5TWU5DX0RPQ1VNRU5UUywgKCkgPT4gdGhpcy5zeW5jKCkpXG4gICAgRGlzcGF0Y2hlci5vbkFjdGlvbihBQ1RJT05TLlNFTEVDVF9ET0NVTUVOVCwgKGRhdGEpID0+IHRoaXMuc2VsZWN0KGRhdGEpKVxuICAgIERpc3BhdGNoZXIub25BY3Rpb24oQUNUSU9OUy5DUkVBVEVfRE9DVU1FTlQsICgpID0+IHRoaXMuY3JlYXRlKCkpXG4gICAgRGlzcGF0Y2hlci5vbkFjdGlvbihBQ1RJT05TLlJFTU9WRV9ET0NVTUVOVCwgKCkgPT4gdGhpcy5yZW1vdmUoKSlcbiAgfVxuICBnZXRJbml0aWFsU3RhdGUoKSB7XG4gICAgcmV0dXJuIHtcbiAgICAgIGRvY3VtZW50czogW10sXG4gICAgICBzZWxlY3RlZDogbnVsbCxcbiAgICB9XG4gIH1cbiAgYXN5bmMgY3JlYXRlKCkge1xuICAgIHRyeSB7XG4gICAgICBsZXQge2RhdGF9ID0gYXdhaXQgZG9jdW1lbnRzLmNyZWF0ZSh7XG4gICAgICAgIGJvZHk6IFwiIyBVbnRpdGxlZFwiXG4gICAgICB9KVxuICAgICAgYXdhaXQgdGhpcy5zeW5jKClcbiAgICAgIHRoaXMuc2VsZWN0KGRhdGEpXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5kaXNwYXRjaCh7XG4gICAgICAgIGFjdGlvblR5cGU6ICdjcmVhdGU6ZmFpbHVyZSdcbiAgICAgIH0pXG4gICAgfVxuICB9XG4gIGFzeW5jIHJlbW92ZSgpIHtcbiAgICB0cnkge1xuICAgICAgbGV0IHtkYXRhfSA9IGF3YWl0IGRvY3VtZW50cy5kZWxldGUodGhpcy5nZXRTdGF0ZSgpLnNlbGVjdGVkLmlkKVxuICAgICAgYXdhaXQgdGhpcy5zeW5jKClcbiAgICAgIHRoaXMuc2VsZWN0KHRoaXMuZ2V0U3RhdGUoKS5kb2N1bWVudHNbMF0pXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5kaXNwYXRjaCh7XG4gICAgICAgIGFjdGlvblR5cGU6ICdjcmVhdGU6ZmFpbHVyZSdcbiAgICAgIH0pXG4gICAgfVxuICB9XG4gIGFzeW5jIHN5bmMoKSB7XG4gICAgdHJ5IHtcbiAgICAgIGxldCB7IGRhdGEgfSA9IGF3YWl0IGRvY3VtZW50cy5zeW5jKClcbiAgICAgIHRoaXMuc2V0U3RhdGUoe1xuICAgICAgICBkb2N1bWVudHM6IGRhdGFcbiAgICAgIH0pXG4gICAgfSBjYXRjaCAoZSkge1xuICAgICAgdGhpcy5kaXNwYXRjaCh7XG4gICAgICAgIGFjdGlvblR5cGU6ICdzeW5jOmZhaWx1cmUnXG4gICAgICB9KVxuICAgIH1cbiAgfVxuICBhc3luYyBzZWxlY3QoeyBpZCB9KSB7XG4gICAgdHJ5IHtcbiAgICAgIGxldCB7IGRhdGEgfSA9IGF3YWl0IGRvY3VtZW50cy5mZXRjaChpZClcbiAgICAgIHRoaXMuc2V0U3RhdGUoe1xuICAgICAgICBzZWxlY3RlZDogZGF0YSxcbiAgICAgIH0pXG4gICAgICBhd2FpdCB0aGlzLnN5bmMoKVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRoaXMuZGlzcGF0Y2goe1xuICAgICAgICBhY3Rpb25UeXBlOiAnc2VsZWN0OmZhaWx1cmUnXG4gICAgICB9KVxuICAgIH1cbiAgfVxuICBhc3luYyBzYXZlKGlkLCBkYXRhKSB7XG4gICAgdHJ5IHtcbiAgICAgIGxldCByZXMgPSBhd2FpdCBkb2N1bWVudHMudXBkYXRlKGlkLCBkYXRhKVxuICAgIH0gY2F0Y2ggKGUpIHtcbiAgICAgIHRoaXMuZGlzcGF0Y2goe1xuICAgICAgICBhY3Rpb25UeXBlOiAnc2F2ZTpmYWlsdXJlJ1xuICAgICAgfSlcbiAgICB9XG4gIH1cbn1cbmV4cG9ydCBkZWZhdWx0IG5ldyBEb2N1bWVudFN0b3JlKClcbiIsIi8qIVxuICogVGhlIGJ1ZmZlciBtb2R1bGUgZnJvbSBub2RlLmpzLCBmb3IgdGhlIGJyb3dzZXIuXG4gKlxuICogQGF1dGhvciAgIEZlcm9zcyBBYm91a2hhZGlqZWggPGZlcm9zc0BmZXJvc3Mub3JnPiA8aHR0cDovL2Zlcm9zcy5vcmc+XG4gKiBAbGljZW5zZSAgTUlUXG4gKi9cbi8qIGVzbGludC1kaXNhYmxlIG5vLXByb3RvICovXG5cbnZhciBiYXNlNjQgPSByZXF1aXJlKCdiYXNlNjQtanMnKVxudmFyIGllZWU3NTQgPSByZXF1aXJlKCdpZWVlNzU0JylcbnZhciBpc0FycmF5ID0gcmVxdWlyZSgnaXMtYXJyYXknKVxuXG5leHBvcnRzLkJ1ZmZlciA9IEJ1ZmZlclxuZXhwb3J0cy5TbG93QnVmZmVyID0gU2xvd0J1ZmZlclxuZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFUyA9IDUwXG5CdWZmZXIucG9vbFNpemUgPSA4MTkyIC8vIG5vdCB1c2VkIGJ5IHRoaXMgaW1wbGVtZW50YXRpb25cblxudmFyIHJvb3RQYXJlbnQgPSB7fVxuXG4vKipcbiAqIElmIGBCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVGA6XG4gKiAgID09PSB0cnVlICAgIFVzZSBVaW50OEFycmF5IGltcGxlbWVudGF0aW9uIChmYXN0ZXN0KVxuICogICA9PT0gZmFsc2UgICBVc2UgT2JqZWN0IGltcGxlbWVudGF0aW9uIChtb3N0IGNvbXBhdGlibGUsIGV2ZW4gSUU2KVxuICpcbiAqIEJyb3dzZXJzIHRoYXQgc3VwcG9ydCB0eXBlZCBhcnJheXMgYXJlIElFIDEwKywgRmlyZWZveCA0KywgQ2hyb21lIDcrLCBTYWZhcmkgNS4xKyxcbiAqIE9wZXJhIDExLjYrLCBpT1MgNC4yKy5cbiAqXG4gKiBEdWUgdG8gdmFyaW91cyBicm93c2VyIGJ1Z3MsIHNvbWV0aW1lcyB0aGUgT2JqZWN0IGltcGxlbWVudGF0aW9uIHdpbGwgYmUgdXNlZCBldmVuXG4gKiB3aGVuIHRoZSBicm93c2VyIHN1cHBvcnRzIHR5cGVkIGFycmF5cy5cbiAqXG4gKiBOb3RlOlxuICpcbiAqICAgLSBGaXJlZm94IDQtMjkgbGFja3Mgc3VwcG9ydCBmb3IgYWRkaW5nIG5ldyBwcm9wZXJ0aWVzIHRvIGBVaW50OEFycmF5YCBpbnN0YW5jZXMsXG4gKiAgICAgU2VlOiBodHRwczovL2J1Z3ppbGxhLm1vemlsbGEub3JnL3Nob3dfYnVnLmNnaT9pZD02OTU0MzguXG4gKlxuICogICAtIFNhZmFyaSA1LTcgbGFja3Mgc3VwcG9ydCBmb3IgY2hhbmdpbmcgdGhlIGBPYmplY3QucHJvdG90eXBlLmNvbnN0cnVjdG9yYCBwcm9wZXJ0eVxuICogICAgIG9uIG9iamVjdHMuXG4gKlxuICogICAtIENocm9tZSA5LTEwIGlzIG1pc3NpbmcgdGhlIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24uXG4gKlxuICogICAtIElFMTAgaGFzIGEgYnJva2VuIGBUeXBlZEFycmF5LnByb3RvdHlwZS5zdWJhcnJheWAgZnVuY3Rpb24gd2hpY2ggcmV0dXJucyBhcnJheXMgb2ZcbiAqICAgICBpbmNvcnJlY3QgbGVuZ3RoIGluIHNvbWUgc2l0dWF0aW9ucy5cblxuICogV2UgZGV0ZWN0IHRoZXNlIGJ1Z2d5IGJyb3dzZXJzIGFuZCBzZXQgYEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUYCB0byBgZmFsc2VgIHNvIHRoZXlcbiAqIGdldCB0aGUgT2JqZWN0IGltcGxlbWVudGF0aW9uLCB3aGljaCBpcyBzbG93ZXIgYnV0IGJlaGF2ZXMgY29ycmVjdGx5LlxuICovXG5CdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCA9IGdsb2JhbC5UWVBFRF9BUlJBWV9TVVBQT1JUICE9PSB1bmRlZmluZWRcbiAgPyBnbG9iYWwuVFlQRURfQVJSQVlfU1VQUE9SVFxuICA6IHR5cGVkQXJyYXlTdXBwb3J0KClcblxuZnVuY3Rpb24gdHlwZWRBcnJheVN1cHBvcnQgKCkge1xuICBmdW5jdGlvbiBCYXIgKCkge31cbiAgdHJ5IHtcbiAgICB2YXIgYXJyID0gbmV3IFVpbnQ4QXJyYXkoMSlcbiAgICBhcnIuZm9vID0gZnVuY3Rpb24gKCkgeyByZXR1cm4gNDIgfVxuICAgIGFyci5jb25zdHJ1Y3RvciA9IEJhclxuICAgIHJldHVybiBhcnIuZm9vKCkgPT09IDQyICYmIC8vIHR5cGVkIGFycmF5IGluc3RhbmNlcyBjYW4gYmUgYXVnbWVudGVkXG4gICAgICAgIGFyci5jb25zdHJ1Y3RvciA9PT0gQmFyICYmIC8vIGNvbnN0cnVjdG9yIGNhbiBiZSBzZXRcbiAgICAgICAgdHlwZW9mIGFyci5zdWJhcnJheSA9PT0gJ2Z1bmN0aW9uJyAmJiAvLyBjaHJvbWUgOS0xMCBsYWNrIGBzdWJhcnJheWBcbiAgICAgICAgYXJyLnN1YmFycmF5KDEsIDEpLmJ5dGVMZW5ndGggPT09IDAgLy8gaWUxMCBoYXMgYnJva2VuIGBzdWJhcnJheWBcbiAgfSBjYXRjaCAoZSkge1xuICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbmZ1bmN0aW9uIGtNYXhMZW5ndGggKCkge1xuICByZXR1cm4gQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlRcbiAgICA/IDB4N2ZmZmZmZmZcbiAgICA6IDB4M2ZmZmZmZmZcbn1cblxuLyoqXG4gKiBDbGFzczogQnVmZmVyXG4gKiA9PT09PT09PT09PT09XG4gKlxuICogVGhlIEJ1ZmZlciBjb25zdHJ1Y3RvciByZXR1cm5zIGluc3RhbmNlcyBvZiBgVWludDhBcnJheWAgdGhhdCBhcmUgYXVnbWVudGVkXG4gKiB3aXRoIGZ1bmN0aW9uIHByb3BlcnRpZXMgZm9yIGFsbCB0aGUgbm9kZSBgQnVmZmVyYCBBUEkgZnVuY3Rpb25zLiBXZSB1c2VcbiAqIGBVaW50OEFycmF5YCBzbyB0aGF0IHNxdWFyZSBicmFja2V0IG5vdGF0aW9uIHdvcmtzIGFzIGV4cGVjdGVkIC0tIGl0IHJldHVybnNcbiAqIGEgc2luZ2xlIG9jdGV0LlxuICpcbiAqIEJ5IGF1Z21lbnRpbmcgdGhlIGluc3RhbmNlcywgd2UgY2FuIGF2b2lkIG1vZGlmeWluZyB0aGUgYFVpbnQ4QXJyYXlgXG4gKiBwcm90b3R5cGUuXG4gKi9cbmZ1bmN0aW9uIEJ1ZmZlciAoYXJnKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBCdWZmZXIpKSB7XG4gICAgLy8gQXZvaWQgZ29pbmcgdGhyb3VnaCBhbiBBcmd1bWVudHNBZGFwdG9yVHJhbXBvbGluZSBpbiB0aGUgY29tbW9uIGNhc2UuXG4gICAgaWYgKGFyZ3VtZW50cy5sZW5ndGggPiAxKSByZXR1cm4gbmV3IEJ1ZmZlcihhcmcsIGFyZ3VtZW50c1sxXSlcbiAgICByZXR1cm4gbmV3IEJ1ZmZlcihhcmcpXG4gIH1cblxuICB0aGlzLmxlbmd0aCA9IDBcbiAgdGhpcy5wYXJlbnQgPSB1bmRlZmluZWRcblxuICAvLyBDb21tb24gY2FzZS5cbiAgaWYgKHR5cGVvZiBhcmcgPT09ICdudW1iZXInKSB7XG4gICAgcmV0dXJuIGZyb21OdW1iZXIodGhpcywgYXJnKVxuICB9XG5cbiAgLy8gU2xpZ2h0bHkgbGVzcyBjb21tb24gY2FzZS5cbiAgaWYgKHR5cGVvZiBhcmcgPT09ICdzdHJpbmcnKSB7XG4gICAgcmV0dXJuIGZyb21TdHJpbmcodGhpcywgYXJnLCBhcmd1bWVudHMubGVuZ3RoID4gMSA/IGFyZ3VtZW50c1sxXSA6ICd1dGY4JylcbiAgfVxuXG4gIC8vIFVudXN1YWwuXG4gIHJldHVybiBmcm9tT2JqZWN0KHRoaXMsIGFyZylcbn1cblxuZnVuY3Rpb24gZnJvbU51bWJlciAodGhhdCwgbGVuZ3RoKSB7XG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGggPCAwID8gMCA6IGNoZWNrZWQobGVuZ3RoKSB8IDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSsrKSB7XG4gICAgICB0aGF0W2ldID0gMFxuICAgIH1cbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tU3RyaW5nICh0aGF0LCBzdHJpbmcsIGVuY29kaW5nKSB7XG4gIGlmICh0eXBlb2YgZW5jb2RpbmcgIT09ICdzdHJpbmcnIHx8IGVuY29kaW5nID09PSAnJykgZW5jb2RpbmcgPSAndXRmOCdcblxuICAvLyBBc3N1bXB0aW9uOiBieXRlTGVuZ3RoKCkgcmV0dXJuIHZhbHVlIGlzIGFsd2F5cyA8IGtNYXhMZW5ndGguXG4gIHZhciBsZW5ndGggPSBieXRlTGVuZ3RoKHN0cmluZywgZW5jb2RpbmcpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuXG4gIHRoYXQud3JpdGUoc3RyaW5nLCBlbmNvZGluZylcbiAgcmV0dXJuIHRoYXRcbn1cblxuZnVuY3Rpb24gZnJvbU9iamVjdCAodGhhdCwgb2JqZWN0KSB7XG4gIGlmIChCdWZmZXIuaXNCdWZmZXIob2JqZWN0KSkgcmV0dXJuIGZyb21CdWZmZXIodGhhdCwgb2JqZWN0KVxuXG4gIGlmIChpc0FycmF5KG9iamVjdCkpIHJldHVybiBmcm9tQXJyYXkodGhhdCwgb2JqZWN0KVxuXG4gIGlmIChvYmplY3QgPT0gbnVsbCkge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ211c3Qgc3RhcnQgd2l0aCBudW1iZXIsIGJ1ZmZlciwgYXJyYXkgb3Igc3RyaW5nJylcbiAgfVxuXG4gIGlmICh0eXBlb2YgQXJyYXlCdWZmZXIgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKG9iamVjdC5idWZmZXIgaW5zdGFuY2VvZiBBcnJheUJ1ZmZlcikge1xuICAgICAgcmV0dXJuIGZyb21UeXBlZEFycmF5KHRoYXQsIG9iamVjdClcbiAgICB9XG4gICAgaWYgKG9iamVjdCBpbnN0YW5jZW9mIEFycmF5QnVmZmVyKSB7XG4gICAgICByZXR1cm4gZnJvbUFycmF5QnVmZmVyKHRoYXQsIG9iamVjdClcbiAgICB9XG4gIH1cblxuICBpZiAob2JqZWN0Lmxlbmd0aCkgcmV0dXJuIGZyb21BcnJheUxpa2UodGhhdCwgb2JqZWN0KVxuXG4gIHJldHVybiBmcm9tSnNvbk9iamVjdCh0aGF0LCBvYmplY3QpXG59XG5cbmZ1bmN0aW9uIGZyb21CdWZmZXIgKHRoYXQsIGJ1ZmZlcikge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChidWZmZXIubGVuZ3RoKSB8IDBcbiAgdGhhdCA9IGFsbG9jYXRlKHRoYXQsIGxlbmd0aClcbiAgYnVmZmVyLmNvcHkodGhhdCwgMCwgMCwgbGVuZ3RoKVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tQXJyYXkgKHRoYXQsIGFycmF5KSB7XG4gIHZhciBsZW5ndGggPSBjaGVja2VkKGFycmF5Lmxlbmd0aCkgfCAwXG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG4vLyBEdXBsaWNhdGUgb2YgZnJvbUFycmF5KCkgdG8ga2VlcCBmcm9tQXJyYXkoKSBtb25vbW9ycGhpYy5cbmZ1bmN0aW9uIGZyb21UeXBlZEFycmF5ICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICAvLyBUcnVuY2F0aW5nIHRoZSBlbGVtZW50cyBpcyBwcm9iYWJseSBub3Qgd2hhdCBwZW9wbGUgZXhwZWN0IGZyb20gdHlwZWRcbiAgLy8gYXJyYXlzIHdpdGggQllURVNfUEVSX0VMRU1FTlQgPiAxIGJ1dCBpdCdzIGNvbXBhdGlibGUgd2l0aCB0aGUgYmVoYXZpb3JcbiAgLy8gb2YgdGhlIG9sZCBCdWZmZXIgY29uc3RydWN0b3IuXG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpICs9IDEpIHtcbiAgICB0aGF0W2ldID0gYXJyYXlbaV0gJiAyNTVcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tQXJyYXlCdWZmZXIgKHRoYXQsIGFycmF5KSB7XG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIFJldHVybiBhbiBhdWdtZW50ZWQgYFVpbnQ4QXJyYXlgIGluc3RhbmNlLCBmb3IgYmVzdCBwZXJmb3JtYW5jZVxuICAgIGFycmF5LmJ5dGVMZW5ndGhcbiAgICB0aGF0ID0gQnVmZmVyLl9hdWdtZW50KG5ldyBVaW50OEFycmF5KGFycmF5KSlcbiAgfSBlbHNlIHtcbiAgICAvLyBGYWxsYmFjazogUmV0dXJuIGFuIG9iamVjdCBpbnN0YW5jZSBvZiB0aGUgQnVmZmVyIGNsYXNzXG4gICAgdGhhdCA9IGZyb21UeXBlZEFycmF5KHRoYXQsIG5ldyBVaW50OEFycmF5KGFycmF5KSlcbiAgfVxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBmcm9tQXJyYXlMaWtlICh0aGF0LCBhcnJheSkge1xuICB2YXIgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB0aGF0ID0gYWxsb2NhdGUodGhhdCwgbGVuZ3RoKVxuICBmb3IgKHZhciBpID0gMDsgaSA8IGxlbmd0aDsgaSArPSAxKSB7XG4gICAgdGhhdFtpXSA9IGFycmF5W2ldICYgMjU1XG4gIH1cbiAgcmV0dXJuIHRoYXRcbn1cblxuLy8gRGVzZXJpYWxpemUgeyB0eXBlOiAnQnVmZmVyJywgZGF0YTogWzEsMiwzLC4uLl0gfSBpbnRvIGEgQnVmZmVyIG9iamVjdC5cbi8vIFJldHVybnMgYSB6ZXJvLWxlbmd0aCBidWZmZXIgZm9yIGlucHV0cyB0aGF0IGRvbid0IGNvbmZvcm0gdG8gdGhlIHNwZWMuXG5mdW5jdGlvbiBmcm9tSnNvbk9iamVjdCAodGhhdCwgb2JqZWN0KSB7XG4gIHZhciBhcnJheVxuICB2YXIgbGVuZ3RoID0gMFxuXG4gIGlmIChvYmplY3QudHlwZSA9PT0gJ0J1ZmZlcicgJiYgaXNBcnJheShvYmplY3QuZGF0YSkpIHtcbiAgICBhcnJheSA9IG9iamVjdC5kYXRhXG4gICAgbGVuZ3RoID0gY2hlY2tlZChhcnJheS5sZW5ndGgpIHwgMFxuICB9XG4gIHRoYXQgPSBhbGxvY2F0ZSh0aGF0LCBsZW5ndGgpXG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkgKz0gMSkge1xuICAgIHRoYXRbaV0gPSBhcnJheVtpXSAmIDI1NVxuICB9XG4gIHJldHVybiB0aGF0XG59XG5cbmlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICBCdWZmZXIucHJvdG90eXBlLl9fcHJvdG9fXyA9IFVpbnQ4QXJyYXkucHJvdG90eXBlXG4gIEJ1ZmZlci5fX3Byb3RvX18gPSBVaW50OEFycmF5XG59XG5cbmZ1bmN0aW9uIGFsbG9jYXRlICh0aGF0LCBsZW5ndGgpIHtcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgLy8gUmV0dXJuIGFuIGF1Z21lbnRlZCBgVWludDhBcnJheWAgaW5zdGFuY2UsIGZvciBiZXN0IHBlcmZvcm1hbmNlXG4gICAgdGhhdCA9IEJ1ZmZlci5fYXVnbWVudChuZXcgVWludDhBcnJheShsZW5ndGgpKVxuICAgIHRoYXQuX19wcm90b19fID0gQnVmZmVyLnByb3RvdHlwZVxuICB9IGVsc2Uge1xuICAgIC8vIEZhbGxiYWNrOiBSZXR1cm4gYW4gb2JqZWN0IGluc3RhbmNlIG9mIHRoZSBCdWZmZXIgY2xhc3NcbiAgICB0aGF0Lmxlbmd0aCA9IGxlbmd0aFxuICAgIHRoYXQuX2lzQnVmZmVyID0gdHJ1ZVxuICB9XG5cbiAgdmFyIGZyb21Qb29sID0gbGVuZ3RoICE9PSAwICYmIGxlbmd0aCA8PSBCdWZmZXIucG9vbFNpemUgPj4+IDFcbiAgaWYgKGZyb21Qb29sKSB0aGF0LnBhcmVudCA9IHJvb3RQYXJlbnRcblxuICByZXR1cm4gdGhhdFxufVxuXG5mdW5jdGlvbiBjaGVja2VkIChsZW5ndGgpIHtcbiAgLy8gTm90ZTogY2Fubm90IHVzZSBgbGVuZ3RoIDwga01heExlbmd0aGAgaGVyZSBiZWNhdXNlIHRoYXQgZmFpbHMgd2hlblxuICAvLyBsZW5ndGggaXMgTmFOICh3aGljaCBpcyBvdGhlcndpc2UgY29lcmNlZCB0byB6ZXJvLilcbiAgaWYgKGxlbmd0aCA+PSBrTWF4TGVuZ3RoKCkpIHtcbiAgICB0aHJvdyBuZXcgUmFuZ2VFcnJvcignQXR0ZW1wdCB0byBhbGxvY2F0ZSBCdWZmZXIgbGFyZ2VyIHRoYW4gbWF4aW11bSAnICtcbiAgICAgICAgICAgICAgICAgICAgICAgICAnc2l6ZTogMHgnICsga01heExlbmd0aCgpLnRvU3RyaW5nKDE2KSArICcgYnl0ZXMnKVxuICB9XG4gIHJldHVybiBsZW5ndGggfCAwXG59XG5cbmZ1bmN0aW9uIFNsb3dCdWZmZXIgKHN1YmplY3QsIGVuY29kaW5nKSB7XG4gIGlmICghKHRoaXMgaW5zdGFuY2VvZiBTbG93QnVmZmVyKSkgcmV0dXJuIG5ldyBTbG93QnVmZmVyKHN1YmplY3QsIGVuY29kaW5nKVxuXG4gIHZhciBidWYgPSBuZXcgQnVmZmVyKHN1YmplY3QsIGVuY29kaW5nKVxuICBkZWxldGUgYnVmLnBhcmVudFxuICByZXR1cm4gYnVmXG59XG5cbkJ1ZmZlci5pc0J1ZmZlciA9IGZ1bmN0aW9uIGlzQnVmZmVyIChiKSB7XG4gIHJldHVybiAhIShiICE9IG51bGwgJiYgYi5faXNCdWZmZXIpXG59XG5cbkJ1ZmZlci5jb21wYXJlID0gZnVuY3Rpb24gY29tcGFyZSAoYSwgYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihhKSB8fCAhQnVmZmVyLmlzQnVmZmVyKGIpKSB7XG4gICAgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnRzIG11c3QgYmUgQnVmZmVycycpXG4gIH1cblxuICBpZiAoYSA9PT0gYikgcmV0dXJuIDBcblxuICB2YXIgeCA9IGEubGVuZ3RoXG4gIHZhciB5ID0gYi5sZW5ndGhcblxuICB2YXIgaSA9IDBcbiAgdmFyIGxlbiA9IE1hdGgubWluKHgsIHkpXG4gIHdoaWxlIChpIDwgbGVuKSB7XG4gICAgaWYgKGFbaV0gIT09IGJbaV0pIGJyZWFrXG5cbiAgICArK2lcbiAgfVxuXG4gIGlmIChpICE9PSBsZW4pIHtcbiAgICB4ID0gYVtpXVxuICAgIHkgPSBiW2ldXG4gIH1cblxuICBpZiAoeCA8IHkpIHJldHVybiAtMVxuICBpZiAoeSA8IHgpIHJldHVybiAxXG4gIHJldHVybiAwXG59XG5cbkJ1ZmZlci5pc0VuY29kaW5nID0gZnVuY3Rpb24gaXNFbmNvZGluZyAoZW5jb2RpbmcpIHtcbiAgc3dpdGNoIChTdHJpbmcoZW5jb2RpbmcpLnRvTG93ZXJDYXNlKCkpIHtcbiAgICBjYXNlICdoZXgnOlxuICAgIGNhc2UgJ3V0ZjgnOlxuICAgIGNhc2UgJ3V0Zi04JzpcbiAgICBjYXNlICdhc2NpaSc6XG4gICAgY2FzZSAnYmluYXJ5JzpcbiAgICBjYXNlICdiYXNlNjQnOlxuICAgIGNhc2UgJ3Jhdyc6XG4gICAgY2FzZSAndWNzMic6XG4gICAgY2FzZSAndWNzLTInOlxuICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgIHJldHVybiB0cnVlXG4gICAgZGVmYXVsdDpcbiAgICAgIHJldHVybiBmYWxzZVxuICB9XG59XG5cbkJ1ZmZlci5jb25jYXQgPSBmdW5jdGlvbiBjb25jYXQgKGxpc3QsIGxlbmd0aCkge1xuICBpZiAoIWlzQXJyYXkobGlzdCkpIHRocm93IG5ldyBUeXBlRXJyb3IoJ2xpc3QgYXJndW1lbnQgbXVzdCBiZSBhbiBBcnJheSBvZiBCdWZmZXJzLicpXG5cbiAgaWYgKGxpc3QubGVuZ3RoID09PSAwKSB7XG4gICAgcmV0dXJuIG5ldyBCdWZmZXIoMClcbiAgfVxuXG4gIHZhciBpXG4gIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCkge1xuICAgIGxlbmd0aCA9IDBcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgICAgbGVuZ3RoICs9IGxpc3RbaV0ubGVuZ3RoXG4gICAgfVxuICB9XG5cbiAgdmFyIGJ1ZiA9IG5ldyBCdWZmZXIobGVuZ3RoKVxuICB2YXIgcG9zID0gMFxuICBmb3IgKGkgPSAwOyBpIDwgbGlzdC5sZW5ndGg7IGkrKykge1xuICAgIHZhciBpdGVtID0gbGlzdFtpXVxuICAgIGl0ZW0uY29weShidWYsIHBvcylcbiAgICBwb3MgKz0gaXRlbS5sZW5ndGhcbiAgfVxuICByZXR1cm4gYnVmXG59XG5cbmZ1bmN0aW9uIGJ5dGVMZW5ndGggKHN0cmluZywgZW5jb2RpbmcpIHtcbiAgaWYgKHR5cGVvZiBzdHJpbmcgIT09ICdzdHJpbmcnKSBzdHJpbmcgPSAnJyArIHN0cmluZ1xuXG4gIHZhciBsZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGlmIChsZW4gPT09IDApIHJldHVybiAwXG5cbiAgLy8gVXNlIGEgZm9yIGxvb3AgdG8gYXZvaWQgcmVjdXJzaW9uXG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG4gIGZvciAoOzspIHtcbiAgICBzd2l0Y2ggKGVuY29kaW5nKSB7XG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICBjYXNlICdiaW5hcnknOlxuICAgICAgLy8gRGVwcmVjYXRlZFxuICAgICAgY2FzZSAncmF3JzpcbiAgICAgIGNhc2UgJ3Jhd3MnOlxuICAgICAgICByZXR1cm4gbGVuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhUb0J5dGVzKHN0cmluZykubGVuZ3RoXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gbGVuICogMlxuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGxlbiA+Pj4gMVxuICAgICAgY2FzZSAnYmFzZTY0JzpcbiAgICAgICAgcmV0dXJuIGJhc2U2NFRvQnl0ZXMoc3RyaW5nKS5sZW5ndGhcbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgcmV0dXJuIHV0ZjhUb0J5dGVzKHN0cmluZykubGVuZ3RoIC8vIGFzc3VtZSB1dGY4XG4gICAgICAgIGVuY29kaW5nID0gKCcnICsgZW5jb2RpbmcpLnRvTG93ZXJDYXNlKClcbiAgICAgICAgbG93ZXJlZENhc2UgPSB0cnVlXG4gICAgfVxuICB9XG59XG5CdWZmZXIuYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGhcblxuLy8gcHJlLXNldCBmb3IgdmFsdWVzIHRoYXQgbWF5IGV4aXN0IGluIHRoZSBmdXR1cmVcbkJ1ZmZlci5wcm90b3R5cGUubGVuZ3RoID0gdW5kZWZpbmVkXG5CdWZmZXIucHJvdG90eXBlLnBhcmVudCA9IHVuZGVmaW5lZFxuXG5mdW5jdGlvbiBzbG93VG9TdHJpbmcgKGVuY29kaW5nLCBzdGFydCwgZW5kKSB7XG4gIHZhciBsb3dlcmVkQ2FzZSA9IGZhbHNlXG5cbiAgc3RhcnQgPSBzdGFydCB8IDBcbiAgZW5kID0gZW5kID09PSB1bmRlZmluZWQgfHwgZW5kID09PSBJbmZpbml0eSA/IHRoaXMubGVuZ3RoIDogZW5kIHwgMFxuXG4gIGlmICghZW5jb2RpbmcpIGVuY29kaW5nID0gJ3V0ZjgnXG4gIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICBpZiAoZW5kID4gdGhpcy5sZW5ndGgpIGVuZCA9IHRoaXMubGVuZ3RoXG4gIGlmIChlbmQgPD0gc3RhcnQpIHJldHVybiAnJ1xuXG4gIHdoaWxlICh0cnVlKSB7XG4gICAgc3dpdGNoIChlbmNvZGluZykge1xuICAgICAgY2FzZSAnaGV4JzpcbiAgICAgICAgcmV0dXJuIGhleFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ3V0ZjgnOlxuICAgICAgY2FzZSAndXRmLTgnOlxuICAgICAgICByZXR1cm4gdXRmOFNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2FzY2lpJzpcbiAgICAgICAgcmV0dXJuIGFzY2lpU2xpY2UodGhpcywgc3RhcnQsIGVuZClcblxuICAgICAgY2FzZSAnYmluYXJ5JzpcbiAgICAgICAgcmV0dXJuIGJpbmFyeVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGNhc2UgJ2Jhc2U2NCc6XG4gICAgICAgIHJldHVybiBiYXNlNjRTbGljZSh0aGlzLCBzdGFydCwgZW5kKVxuXG4gICAgICBjYXNlICd1Y3MyJzpcbiAgICAgIGNhc2UgJ3Vjcy0yJzpcbiAgICAgIGNhc2UgJ3V0ZjE2bGUnOlxuICAgICAgY2FzZSAndXRmLTE2bGUnOlxuICAgICAgICByZXR1cm4gdXRmMTZsZVNsaWNlKHRoaXMsIHN0YXJ0LCBlbmQpXG5cbiAgICAgIGRlZmF1bHQ6XG4gICAgICAgIGlmIChsb3dlcmVkQ2FzZSkgdGhyb3cgbmV3IFR5cGVFcnJvcignVW5rbm93biBlbmNvZGluZzogJyArIGVuY29kaW5nKVxuICAgICAgICBlbmNvZGluZyA9IChlbmNvZGluZyArICcnKS50b0xvd2VyQ2FzZSgpXG4gICAgICAgIGxvd2VyZWRDYXNlID0gdHJ1ZVxuICAgIH1cbiAgfVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnRvU3RyaW5nID0gZnVuY3Rpb24gdG9TdHJpbmcgKCkge1xuICB2YXIgbGVuZ3RoID0gdGhpcy5sZW5ndGggfCAwXG4gIGlmIChsZW5ndGggPT09IDApIHJldHVybiAnJ1xuICBpZiAoYXJndW1lbnRzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIHV0ZjhTbGljZSh0aGlzLCAwLCBsZW5ndGgpXG4gIHJldHVybiBzbG93VG9TdHJpbmcuYXBwbHkodGhpcywgYXJndW1lbnRzKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLmVxdWFscyA9IGZ1bmN0aW9uIGVxdWFscyAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIGlmICh0aGlzID09PSBiKSByZXR1cm4gdHJ1ZVxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYikgPT09IDBcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbnNwZWN0ID0gZnVuY3Rpb24gaW5zcGVjdCAoKSB7XG4gIHZhciBzdHIgPSAnJ1xuICB2YXIgbWF4ID0gZXhwb3J0cy5JTlNQRUNUX01BWF9CWVRFU1xuICBpZiAodGhpcy5sZW5ndGggPiAwKSB7XG4gICAgc3RyID0gdGhpcy50b1N0cmluZygnaGV4JywgMCwgbWF4KS5tYXRjaCgvLnsyfS9nKS5qb2luKCcgJylcbiAgICBpZiAodGhpcy5sZW5ndGggPiBtYXgpIHN0ciArPSAnIC4uLiAnXG4gIH1cbiAgcmV0dXJuICc8QnVmZmVyICcgKyBzdHIgKyAnPidcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5jb21wYXJlID0gZnVuY3Rpb24gY29tcGFyZSAoYikge1xuICBpZiAoIUJ1ZmZlci5pc0J1ZmZlcihiKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignQXJndW1lbnQgbXVzdCBiZSBhIEJ1ZmZlcicpXG4gIGlmICh0aGlzID09PSBiKSByZXR1cm4gMFxuICByZXR1cm4gQnVmZmVyLmNvbXBhcmUodGhpcywgYilcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5pbmRleE9mID0gZnVuY3Rpb24gaW5kZXhPZiAodmFsLCBieXRlT2Zmc2V0KSB7XG4gIGlmIChieXRlT2Zmc2V0ID4gMHg3ZmZmZmZmZikgYnl0ZU9mZnNldCA9IDB4N2ZmZmZmZmZcbiAgZWxzZSBpZiAoYnl0ZU9mZnNldCA8IC0weDgwMDAwMDAwKSBieXRlT2Zmc2V0ID0gLTB4ODAwMDAwMDBcbiAgYnl0ZU9mZnNldCA+Pj0gMFxuXG4gIGlmICh0aGlzLmxlbmd0aCA9PT0gMCkgcmV0dXJuIC0xXG4gIGlmIChieXRlT2Zmc2V0ID49IHRoaXMubGVuZ3RoKSByZXR1cm4gLTFcblxuICAvLyBOZWdhdGl2ZSBvZmZzZXRzIHN0YXJ0IGZyb20gdGhlIGVuZCBvZiB0aGUgYnVmZmVyXG4gIGlmIChieXRlT2Zmc2V0IDwgMCkgYnl0ZU9mZnNldCA9IE1hdGgubWF4KHRoaXMubGVuZ3RoICsgYnl0ZU9mZnNldCwgMClcblxuICBpZiAodHlwZW9mIHZhbCA9PT0gJ3N0cmluZycpIHtcbiAgICBpZiAodmFsLmxlbmd0aCA9PT0gMCkgcmV0dXJuIC0xIC8vIHNwZWNpYWwgY2FzZTogbG9va2luZyBmb3IgZW1wdHkgc3RyaW5nIGFsd2F5cyBmYWlsc1xuICAgIHJldHVybiBTdHJpbmcucHJvdG90eXBlLmluZGV4T2YuY2FsbCh0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gIH1cbiAgaWYgKEJ1ZmZlci5pc0J1ZmZlcih2YWwpKSB7XG4gICAgcmV0dXJuIGFycmF5SW5kZXhPZih0aGlzLCB2YWwsIGJ5dGVPZmZzZXQpXG4gIH1cbiAgaWYgKHR5cGVvZiB2YWwgPT09ICdudW1iZXInKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUICYmIFVpbnQ4QXJyYXkucHJvdG90eXBlLmluZGV4T2YgPT09ICdmdW5jdGlvbicpIHtcbiAgICAgIHJldHVybiBVaW50OEFycmF5LnByb3RvdHlwZS5pbmRleE9mLmNhbGwodGhpcywgdmFsLCBieXRlT2Zmc2V0KVxuICAgIH1cbiAgICByZXR1cm4gYXJyYXlJbmRleE9mKHRoaXMsIFsgdmFsIF0sIGJ5dGVPZmZzZXQpXG4gIH1cblxuICBmdW5jdGlvbiBhcnJheUluZGV4T2YgKGFyciwgdmFsLCBieXRlT2Zmc2V0KSB7XG4gICAgdmFyIGZvdW5kSW5kZXggPSAtMVxuICAgIGZvciAodmFyIGkgPSAwOyBieXRlT2Zmc2V0ICsgaSA8IGFyci5sZW5ndGg7IGkrKykge1xuICAgICAgaWYgKGFycltieXRlT2Zmc2V0ICsgaV0gPT09IHZhbFtmb3VuZEluZGV4ID09PSAtMSA/IDAgOiBpIC0gZm91bmRJbmRleF0pIHtcbiAgICAgICAgaWYgKGZvdW5kSW5kZXggPT09IC0xKSBmb3VuZEluZGV4ID0gaVxuICAgICAgICBpZiAoaSAtIGZvdW5kSW5kZXggKyAxID09PSB2YWwubGVuZ3RoKSByZXR1cm4gYnl0ZU9mZnNldCArIGZvdW5kSW5kZXhcbiAgICAgIH0gZWxzZSB7XG4gICAgICAgIGZvdW5kSW5kZXggPSAtMVxuICAgICAgfVxuICAgIH1cbiAgICByZXR1cm4gLTFcbiAgfVxuXG4gIHRocm93IG5ldyBUeXBlRXJyb3IoJ3ZhbCBtdXN0IGJlIHN0cmluZywgbnVtYmVyIG9yIEJ1ZmZlcicpXG59XG5cbi8vIGBnZXRgIGlzIGRlcHJlY2F0ZWRcbkJ1ZmZlci5wcm90b3R5cGUuZ2V0ID0gZnVuY3Rpb24gZ2V0IChvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5nZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLnJlYWRVSW50OChvZmZzZXQpXG59XG5cbi8vIGBzZXRgIGlzIGRlcHJlY2F0ZWRcbkJ1ZmZlci5wcm90b3R5cGUuc2V0ID0gZnVuY3Rpb24gc2V0ICh2LCBvZmZzZXQpIHtcbiAgY29uc29sZS5sb2coJy5zZXQoKSBpcyBkZXByZWNhdGVkLiBBY2Nlc3MgdXNpbmcgYXJyYXkgaW5kZXhlcyBpbnN0ZWFkLicpXG4gIHJldHVybiB0aGlzLndyaXRlVUludDgodiwgb2Zmc2V0KVxufVxuXG5mdW5jdGlvbiBoZXhXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIG9mZnNldCA9IE51bWJlcihvZmZzZXQpIHx8IDBcbiAgdmFyIHJlbWFpbmluZyA9IGJ1Zi5sZW5ndGggLSBvZmZzZXRcbiAgaWYgKCFsZW5ndGgpIHtcbiAgICBsZW5ndGggPSByZW1haW5pbmdcbiAgfSBlbHNlIHtcbiAgICBsZW5ndGggPSBOdW1iZXIobGVuZ3RoKVxuICAgIGlmIChsZW5ndGggPiByZW1haW5pbmcpIHtcbiAgICAgIGxlbmd0aCA9IHJlbWFpbmluZ1xuICAgIH1cbiAgfVxuXG4gIC8vIG11c3QgYmUgYW4gZXZlbiBudW1iZXIgb2YgZGlnaXRzXG4gIHZhciBzdHJMZW4gPSBzdHJpbmcubGVuZ3RoXG4gIGlmIChzdHJMZW4gJSAyICE9PSAwKSB0aHJvdyBuZXcgRXJyb3IoJ0ludmFsaWQgaGV4IHN0cmluZycpXG5cbiAgaWYgKGxlbmd0aCA+IHN0ckxlbiAvIDIpIHtcbiAgICBsZW5ndGggPSBzdHJMZW4gLyAyXG4gIH1cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIHZhciBwYXJzZWQgPSBwYXJzZUludChzdHJpbmcuc3Vic3RyKGkgKiAyLCAyKSwgMTYpXG4gICAgaWYgKGlzTmFOKHBhcnNlZCkpIHRocm93IG5ldyBFcnJvcignSW52YWxpZCBoZXggc3RyaW5nJylcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSBwYXJzZWRcbiAgfVxuICByZXR1cm4gaVxufVxuXG5mdW5jdGlvbiB1dGY4V3JpdGUgKGJ1Ziwgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aCkge1xuICByZXR1cm4gYmxpdEJ1ZmZlcih1dGY4VG9CeXRlcyhzdHJpbmcsIGJ1Zi5sZW5ndGggLSBvZmZzZXQpLCBidWYsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBhc2NpaVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIoYXNjaWlUb0J5dGVzKHN0cmluZyksIGJ1Ziwgb2Zmc2V0LCBsZW5ndGgpXG59XG5cbmZ1bmN0aW9uIGJpbmFyeVdyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGFzY2lpV3JpdGUoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxufVxuXG5mdW5jdGlvbiBiYXNlNjRXcml0ZSAoYnVmLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIHJldHVybiBibGl0QnVmZmVyKGJhc2U2NFRvQnl0ZXMoc3RyaW5nKSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuZnVuY3Rpb24gdWNzMldyaXRlIChidWYsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpIHtcbiAgcmV0dXJuIGJsaXRCdWZmZXIodXRmMTZsZVRvQnl0ZXMoc3RyaW5nLCBidWYubGVuZ3RoIC0gb2Zmc2V0KSwgYnVmLCBvZmZzZXQsIGxlbmd0aClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZSA9IGZ1bmN0aW9uIHdyaXRlIChzdHJpbmcsIG9mZnNldCwgbGVuZ3RoLCBlbmNvZGluZykge1xuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nKVxuICBpZiAob2Zmc2V0ID09PSB1bmRlZmluZWQpIHtcbiAgICBlbmNvZGluZyA9ICd1dGY4J1xuICAgIGxlbmd0aCA9IHRoaXMubGVuZ3RoXG4gICAgb2Zmc2V0ID0gMFxuICAvLyBCdWZmZXIjd3JpdGUoc3RyaW5nLCBlbmNvZGluZylcbiAgfSBlbHNlIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCAmJiB0eXBlb2Ygb2Zmc2V0ID09PSAnc3RyaW5nJykge1xuICAgIGVuY29kaW5nID0gb2Zmc2V0XG4gICAgbGVuZ3RoID0gdGhpcy5sZW5ndGhcbiAgICBvZmZzZXQgPSAwXG4gIC8vIEJ1ZmZlciN3cml0ZShzdHJpbmcsIG9mZnNldFssIGxlbmd0aF1bLCBlbmNvZGluZ10pXG4gIH0gZWxzZSBpZiAoaXNGaW5pdGUob2Zmc2V0KSkge1xuICAgIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgICBpZiAoaXNGaW5pdGUobGVuZ3RoKSkge1xuICAgICAgbGVuZ3RoID0gbGVuZ3RoIHwgMFxuICAgICAgaWYgKGVuY29kaW5nID09PSB1bmRlZmluZWQpIGVuY29kaW5nID0gJ3V0ZjgnXG4gICAgfSBlbHNlIHtcbiAgICAgIGVuY29kaW5nID0gbGVuZ3RoXG4gICAgICBsZW5ndGggPSB1bmRlZmluZWRcbiAgICB9XG4gIC8vIGxlZ2FjeSB3cml0ZShzdHJpbmcsIGVuY29kaW5nLCBvZmZzZXQsIGxlbmd0aCkgLSByZW1vdmUgaW4gdjAuMTNcbiAgfSBlbHNlIHtcbiAgICB2YXIgc3dhcCA9IGVuY29kaW5nXG4gICAgZW5jb2RpbmcgPSBvZmZzZXRcbiAgICBvZmZzZXQgPSBsZW5ndGggfCAwXG4gICAgbGVuZ3RoID0gc3dhcFxuICB9XG5cbiAgdmFyIHJlbWFpbmluZyA9IHRoaXMubGVuZ3RoIC0gb2Zmc2V0XG4gIGlmIChsZW5ndGggPT09IHVuZGVmaW5lZCB8fCBsZW5ndGggPiByZW1haW5pbmcpIGxlbmd0aCA9IHJlbWFpbmluZ1xuXG4gIGlmICgoc3RyaW5nLmxlbmd0aCA+IDAgJiYgKGxlbmd0aCA8IDAgfHwgb2Zmc2V0IDwgMCkpIHx8IG9mZnNldCA+IHRoaXMubGVuZ3RoKSB7XG4gICAgdGhyb3cgbmV3IFJhbmdlRXJyb3IoJ2F0dGVtcHQgdG8gd3JpdGUgb3V0c2lkZSBidWZmZXIgYm91bmRzJylcbiAgfVxuXG4gIGlmICghZW5jb2RpbmcpIGVuY29kaW5nID0gJ3V0ZjgnXG5cbiAgdmFyIGxvd2VyZWRDYXNlID0gZmFsc2VcbiAgZm9yICg7Oykge1xuICAgIHN3aXRjaCAoZW5jb2RpbmcpIHtcbiAgICAgIGNhc2UgJ2hleCc6XG4gICAgICAgIHJldHVybiBoZXhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICd1dGY4JzpcbiAgICAgIGNhc2UgJ3V0Zi04JzpcbiAgICAgICAgcmV0dXJuIHV0ZjhXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdhc2NpaSc6XG4gICAgICAgIHJldHVybiBhc2NpaVdyaXRlKHRoaXMsIHN0cmluZywgb2Zmc2V0LCBsZW5ndGgpXG5cbiAgICAgIGNhc2UgJ2JpbmFyeSc6XG4gICAgICAgIHJldHVybiBiaW5hcnlXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBjYXNlICdiYXNlNjQnOlxuICAgICAgICAvLyBXYXJuaW5nOiBtYXhMZW5ndGggbm90IHRha2VuIGludG8gYWNjb3VudCBpbiBiYXNlNjRXcml0ZVxuICAgICAgICByZXR1cm4gYmFzZTY0V3JpdGUodGhpcywgc3RyaW5nLCBvZmZzZXQsIGxlbmd0aClcblxuICAgICAgY2FzZSAndWNzMic6XG4gICAgICBjYXNlICd1Y3MtMic6XG4gICAgICBjYXNlICd1dGYxNmxlJzpcbiAgICAgIGNhc2UgJ3V0Zi0xNmxlJzpcbiAgICAgICAgcmV0dXJuIHVjczJXcml0ZSh0aGlzLCBzdHJpbmcsIG9mZnNldCwgbGVuZ3RoKVxuXG4gICAgICBkZWZhdWx0OlxuICAgICAgICBpZiAobG93ZXJlZENhc2UpIHRocm93IG5ldyBUeXBlRXJyb3IoJ1Vua25vd24gZW5jb2Rpbmc6ICcgKyBlbmNvZGluZylcbiAgICAgICAgZW5jb2RpbmcgPSAoJycgKyBlbmNvZGluZykudG9Mb3dlckNhc2UoKVxuICAgICAgICBsb3dlcmVkQ2FzZSA9IHRydWVcbiAgICB9XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS50b0pTT04gPSBmdW5jdGlvbiB0b0pTT04gKCkge1xuICByZXR1cm4ge1xuICAgIHR5cGU6ICdCdWZmZXInLFxuICAgIGRhdGE6IEFycmF5LnByb3RvdHlwZS5zbGljZS5jYWxsKHRoaXMuX2FyciB8fCB0aGlzLCAwKVxuICB9XG59XG5cbmZ1bmN0aW9uIGJhc2U2NFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKHN0YXJ0ID09PSAwICYmIGVuZCA9PT0gYnVmLmxlbmd0aCkge1xuICAgIHJldHVybiBiYXNlNjQuZnJvbUJ5dGVBcnJheShidWYpXG4gIH0gZWxzZSB7XG4gICAgcmV0dXJuIGJhc2U2NC5mcm9tQnl0ZUFycmF5KGJ1Zi5zbGljZShzdGFydCwgZW5kKSlcbiAgfVxufVxuXG5mdW5jdGlvbiB1dGY4U2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICBlbmQgPSBNYXRoLm1pbihidWYubGVuZ3RoLCBlbmQpXG4gIHZhciByZXMgPSBbXVxuXG4gIHZhciBpID0gc3RhcnRcbiAgd2hpbGUgKGkgPCBlbmQpIHtcbiAgICB2YXIgZmlyc3RCeXRlID0gYnVmW2ldXG4gICAgdmFyIGNvZGVQb2ludCA9IG51bGxcbiAgICB2YXIgYnl0ZXNQZXJTZXF1ZW5jZSA9IChmaXJzdEJ5dGUgPiAweEVGKSA/IDRcbiAgICAgIDogKGZpcnN0Qnl0ZSA+IDB4REYpID8gM1xuICAgICAgOiAoZmlyc3RCeXRlID4gMHhCRikgPyAyXG4gICAgICA6IDFcblxuICAgIGlmIChpICsgYnl0ZXNQZXJTZXF1ZW5jZSA8PSBlbmQpIHtcbiAgICAgIHZhciBzZWNvbmRCeXRlLCB0aGlyZEJ5dGUsIGZvdXJ0aEJ5dGUsIHRlbXBDb2RlUG9pbnRcblxuICAgICAgc3dpdGNoIChieXRlc1BlclNlcXVlbmNlKSB7XG4gICAgICAgIGNhc2UgMTpcbiAgICAgICAgICBpZiAoZmlyc3RCeXRlIDwgMHg4MCkge1xuICAgICAgICAgICAgY29kZVBvaW50ID0gZmlyc3RCeXRlXG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgMjpcbiAgICAgICAgICBzZWNvbmRCeXRlID0gYnVmW2kgKyAxXVxuICAgICAgICAgIGlmICgoc2Vjb25kQnl0ZSAmIDB4QzApID09PSAweDgwKSB7XG4gICAgICAgICAgICB0ZW1wQ29kZVBvaW50ID0gKGZpcnN0Qnl0ZSAmIDB4MUYpIDw8IDB4NiB8IChzZWNvbmRCeXRlICYgMHgzRilcbiAgICAgICAgICAgIGlmICh0ZW1wQ29kZVBvaW50ID4gMHg3Rikge1xuICAgICAgICAgICAgICBjb2RlUG9pbnQgPSB0ZW1wQ29kZVBvaW50XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgMzpcbiAgICAgICAgICBzZWNvbmRCeXRlID0gYnVmW2kgKyAxXVxuICAgICAgICAgIHRoaXJkQnl0ZSA9IGJ1ZltpICsgMl1cbiAgICAgICAgICBpZiAoKHNlY29uZEJ5dGUgJiAweEMwKSA9PT0gMHg4MCAmJiAodGhpcmRCeXRlICYgMHhDMCkgPT09IDB4ODApIHtcbiAgICAgICAgICAgIHRlbXBDb2RlUG9pbnQgPSAoZmlyc3RCeXRlICYgMHhGKSA8PCAweEMgfCAoc2Vjb25kQnl0ZSAmIDB4M0YpIDw8IDB4NiB8ICh0aGlyZEJ5dGUgJiAweDNGKVxuICAgICAgICAgICAgaWYgKHRlbXBDb2RlUG9pbnQgPiAweDdGRiAmJiAodGVtcENvZGVQb2ludCA8IDB4RDgwMCB8fCB0ZW1wQ29kZVBvaW50ID4gMHhERkZGKSkge1xuICAgICAgICAgICAgICBjb2RlUG9pbnQgPSB0ZW1wQ29kZVBvaW50XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgICAgIGJyZWFrXG4gICAgICAgIGNhc2UgNDpcbiAgICAgICAgICBzZWNvbmRCeXRlID0gYnVmW2kgKyAxXVxuICAgICAgICAgIHRoaXJkQnl0ZSA9IGJ1ZltpICsgMl1cbiAgICAgICAgICBmb3VydGhCeXRlID0gYnVmW2kgKyAzXVxuICAgICAgICAgIGlmICgoc2Vjb25kQnl0ZSAmIDB4QzApID09PSAweDgwICYmICh0aGlyZEJ5dGUgJiAweEMwKSA9PT0gMHg4MCAmJiAoZm91cnRoQnl0ZSAmIDB4QzApID09PSAweDgwKSB7XG4gICAgICAgICAgICB0ZW1wQ29kZVBvaW50ID0gKGZpcnN0Qnl0ZSAmIDB4RikgPDwgMHgxMiB8IChzZWNvbmRCeXRlICYgMHgzRikgPDwgMHhDIHwgKHRoaXJkQnl0ZSAmIDB4M0YpIDw8IDB4NiB8IChmb3VydGhCeXRlICYgMHgzRilcbiAgICAgICAgICAgIGlmICh0ZW1wQ29kZVBvaW50ID4gMHhGRkZGICYmIHRlbXBDb2RlUG9pbnQgPCAweDExMDAwMCkge1xuICAgICAgICAgICAgICBjb2RlUG9pbnQgPSB0ZW1wQ29kZVBvaW50XG4gICAgICAgICAgICB9XG4gICAgICAgICAgfVxuICAgICAgfVxuICAgIH1cblxuICAgIGlmIChjb2RlUG9pbnQgPT09IG51bGwpIHtcbiAgICAgIC8vIHdlIGRpZCBub3QgZ2VuZXJhdGUgYSB2YWxpZCBjb2RlUG9pbnQgc28gaW5zZXJ0IGFcbiAgICAgIC8vIHJlcGxhY2VtZW50IGNoYXIgKFUrRkZGRCkgYW5kIGFkdmFuY2Ugb25seSAxIGJ5dGVcbiAgICAgIGNvZGVQb2ludCA9IDB4RkZGRFxuICAgICAgYnl0ZXNQZXJTZXF1ZW5jZSA9IDFcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA+IDB4RkZGRikge1xuICAgICAgLy8gZW5jb2RlIHRvIHV0ZjE2IChzdXJyb2dhdGUgcGFpciBkYW5jZSlcbiAgICAgIGNvZGVQb2ludCAtPSAweDEwMDAwXG4gICAgICByZXMucHVzaChjb2RlUG9pbnQgPj4+IDEwICYgMHgzRkYgfCAweEQ4MDApXG4gICAgICBjb2RlUG9pbnQgPSAweERDMDAgfCBjb2RlUG9pbnQgJiAweDNGRlxuICAgIH1cblxuICAgIHJlcy5wdXNoKGNvZGVQb2ludClcbiAgICBpICs9IGJ5dGVzUGVyU2VxdWVuY2VcbiAgfVxuXG4gIHJldHVybiBkZWNvZGVDb2RlUG9pbnRzQXJyYXkocmVzKVxufVxuXG4vLyBCYXNlZCBvbiBodHRwOi8vc3RhY2tvdmVyZmxvdy5jb20vYS8yMjc0NzI3Mi82ODA3NDIsIHRoZSBicm93c2VyIHdpdGhcbi8vIHRoZSBsb3dlc3QgbGltaXQgaXMgQ2hyb21lLCB3aXRoIDB4MTAwMDAgYXJncy5cbi8vIFdlIGdvIDEgbWFnbml0dWRlIGxlc3MsIGZvciBzYWZldHlcbnZhciBNQVhfQVJHVU1FTlRTX0xFTkdUSCA9IDB4MTAwMFxuXG5mdW5jdGlvbiBkZWNvZGVDb2RlUG9pbnRzQXJyYXkgKGNvZGVQb2ludHMpIHtcbiAgdmFyIGxlbiA9IGNvZGVQb2ludHMubGVuZ3RoXG4gIGlmIChsZW4gPD0gTUFYX0FSR1VNRU5UU19MRU5HVEgpIHtcbiAgICByZXR1cm4gU3RyaW5nLmZyb21DaGFyQ29kZS5hcHBseShTdHJpbmcsIGNvZGVQb2ludHMpIC8vIGF2b2lkIGV4dHJhIHNsaWNlKClcbiAgfVxuXG4gIC8vIERlY29kZSBpbiBjaHVua3MgdG8gYXZvaWQgXCJjYWxsIHN0YWNrIHNpemUgZXhjZWVkZWRcIi5cbiAgdmFyIHJlcyA9ICcnXG4gIHZhciBpID0gMFxuICB3aGlsZSAoaSA8IGxlbikge1xuICAgIHJlcyArPSBTdHJpbmcuZnJvbUNoYXJDb2RlLmFwcGx5KFxuICAgICAgU3RyaW5nLFxuICAgICAgY29kZVBvaW50cy5zbGljZShpLCBpICs9IE1BWF9BUkdVTUVOVFNfTEVOR1RIKVxuICAgIClcbiAgfVxuICByZXR1cm4gcmVzXG59XG5cbmZ1bmN0aW9uIGFzY2lpU2xpY2UgKGJ1Ziwgc3RhcnQsIGVuZCkge1xuICB2YXIgcmV0ID0gJydcbiAgZW5kID0gTWF0aC5taW4oYnVmLmxlbmd0aCwgZW5kKVxuXG4gIGZvciAodmFyIGkgPSBzdGFydDsgaSA8IGVuZDsgaSsrKSB7XG4gICAgcmV0ICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnVmW2ldICYgMHg3RilcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGJpbmFyeVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIHJldCA9ICcnXG4gIGVuZCA9IE1hdGgubWluKGJ1Zi5sZW5ndGgsIGVuZClcblxuICBmb3IgKHZhciBpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgIHJldCArPSBTdHJpbmcuZnJvbUNoYXJDb2RlKGJ1ZltpXSlcbiAgfVxuICByZXR1cm4gcmV0XG59XG5cbmZ1bmN0aW9uIGhleFNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IGJ1Zi5sZW5ndGhcblxuICBpZiAoIXN0YXJ0IHx8IHN0YXJ0IDwgMCkgc3RhcnQgPSAwXG4gIGlmICghZW5kIHx8IGVuZCA8IDAgfHwgZW5kID4gbGVuKSBlbmQgPSBsZW5cblxuICB2YXIgb3V0ID0gJydcbiAgZm9yICh2YXIgaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICBvdXQgKz0gdG9IZXgoYnVmW2ldKVxuICB9XG4gIHJldHVybiBvdXRcbn1cblxuZnVuY3Rpb24gdXRmMTZsZVNsaWNlIChidWYsIHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGJ5dGVzID0gYnVmLnNsaWNlKHN0YXJ0LCBlbmQpXG4gIHZhciByZXMgPSAnJ1xuICBmb3IgKHZhciBpID0gMDsgaSA8IGJ5dGVzLmxlbmd0aDsgaSArPSAyKSB7XG4gICAgcmVzICs9IFN0cmluZy5mcm9tQ2hhckNvZGUoYnl0ZXNbaV0gKyBieXRlc1tpICsgMV0gKiAyNTYpXG4gIH1cbiAgcmV0dXJuIHJlc1xufVxuXG5CdWZmZXIucHJvdG90eXBlLnNsaWNlID0gZnVuY3Rpb24gc2xpY2UgKHN0YXJ0LCBlbmQpIHtcbiAgdmFyIGxlbiA9IHRoaXMubGVuZ3RoXG4gIHN0YXJ0ID0gfn5zdGFydFxuICBlbmQgPSBlbmQgPT09IHVuZGVmaW5lZCA/IGxlbiA6IH5+ZW5kXG5cbiAgaWYgKHN0YXJ0IDwgMCkge1xuICAgIHN0YXJ0ICs9IGxlblxuICAgIGlmIChzdGFydCA8IDApIHN0YXJ0ID0gMFxuICB9IGVsc2UgaWYgKHN0YXJ0ID4gbGVuKSB7XG4gICAgc3RhcnQgPSBsZW5cbiAgfVxuXG4gIGlmIChlbmQgPCAwKSB7XG4gICAgZW5kICs9IGxlblxuICAgIGlmIChlbmQgPCAwKSBlbmQgPSAwXG4gIH0gZWxzZSBpZiAoZW5kID4gbGVuKSB7XG4gICAgZW5kID0gbGVuXG4gIH1cblxuICBpZiAoZW5kIDwgc3RhcnQpIGVuZCA9IHN0YXJ0XG5cbiAgdmFyIG5ld0J1ZlxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICBuZXdCdWYgPSBCdWZmZXIuX2F1Z21lbnQodGhpcy5zdWJhcnJheShzdGFydCwgZW5kKSlcbiAgfSBlbHNlIHtcbiAgICB2YXIgc2xpY2VMZW4gPSBlbmQgLSBzdGFydFxuICAgIG5ld0J1ZiA9IG5ldyBCdWZmZXIoc2xpY2VMZW4sIHVuZGVmaW5lZClcbiAgICBmb3IgKHZhciBpID0gMDsgaSA8IHNsaWNlTGVuOyBpKyspIHtcbiAgICAgIG5ld0J1ZltpXSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfVxuXG4gIGlmIChuZXdCdWYubGVuZ3RoKSBuZXdCdWYucGFyZW50ID0gdGhpcy5wYXJlbnQgfHwgdGhpc1xuXG4gIHJldHVybiBuZXdCdWZcbn1cblxuLypcbiAqIE5lZWQgdG8gbWFrZSBzdXJlIHRoYXQgYnVmZmVyIGlzbid0IHRyeWluZyB0byB3cml0ZSBvdXQgb2YgYm91bmRzLlxuICovXG5mdW5jdGlvbiBjaGVja09mZnNldCAob2Zmc2V0LCBleHQsIGxlbmd0aCkge1xuICBpZiAoKG9mZnNldCAlIDEpICE9PSAwIHx8IG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdvZmZzZXQgaXMgbm90IHVpbnQnKVxuICBpZiAob2Zmc2V0ICsgZXh0ID4gbGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignVHJ5aW5nIHRvIGFjY2VzcyBiZXlvbmQgYnVmZmVyIGxlbmd0aCcpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRMRSA9IGZ1bmN0aW9uIHJlYWRVSW50TEUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCBieXRlTGVuZ3RoLCB0aGlzLmxlbmd0aClcblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXRdXG4gIHZhciBtdWwgPSAxXG4gIHZhciBpID0gMFxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIGldICogbXVsXG4gIH1cblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnRCRSA9IGZ1bmN0aW9uIHJlYWRVSW50QkUgKG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBieXRlTGVuZ3RoID0gYnl0ZUxlbmd0aCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG4gIH1cblxuICB2YXIgdmFsID0gdGhpc1tvZmZzZXQgKyAtLWJ5dGVMZW5ndGhdXG4gIHZhciBtdWwgPSAxXG4gIHdoaWxlIChieXRlTGVuZ3RoID4gMCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHZhbCArPSB0aGlzW29mZnNldCArIC0tYnl0ZUxlbmd0aF0gKiBtdWxcbiAgfVxuXG4gIHJldHVybiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDggPSBmdW5jdGlvbiByZWFkVUludDggKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAxLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuIHRoaXNbb2Zmc2V0XVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MTZMRSA9IGZ1bmN0aW9uIHJlYWRVSW50MTZMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDIsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gdGhpc1tvZmZzZXRdIHwgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkVUludDE2QkUgPSBmdW5jdGlvbiByZWFkVUludDE2QkUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgcmV0dXJuICh0aGlzW29mZnNldF0gPDwgOCkgfCB0aGlzW29mZnNldCArIDFdXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZFVJbnQzMkxFID0gZnVuY3Rpb24gcmVhZFVJbnQzMkxFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgNCwgdGhpcy5sZW5ndGgpXG5cbiAgcmV0dXJuICgodGhpc1tvZmZzZXRdKSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAxXSA8PCA4KSB8XG4gICAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCAxNikpICtcbiAgICAgICh0aGlzW29mZnNldCArIDNdICogMHgxMDAwMDAwKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRVSW50MzJCRSA9IGZ1bmN0aW9uIHJlYWRVSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdICogMHgxMDAwMDAwKSArXG4gICAgKCh0aGlzW29mZnNldCArIDFdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMl0gPDwgOCkgfFxuICAgIHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludExFID0gZnVuY3Rpb24gcmVhZEludExFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XVxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgd2hpbGUgKCsraSA8IGJ5dGVMZW5ndGggJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB2YWwgKz0gdGhpc1tvZmZzZXQgKyBpXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludEJFID0gZnVuY3Rpb24gcmVhZEludEJFIChvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgYnl0ZUxlbmd0aCwgdGhpcy5sZW5ndGgpXG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoXG4gIHZhciBtdWwgPSAxXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIC0taV1cbiAgd2hpbGUgKGkgPiAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdmFsICs9IHRoaXNbb2Zmc2V0ICsgLS1pXSAqIG11bFxuICB9XG4gIG11bCAqPSAweDgwXG5cbiAgaWYgKHZhbCA+PSBtdWwpIHZhbCAtPSBNYXRoLnBvdygyLCA4ICogYnl0ZUxlbmd0aClcblxuICByZXR1cm4gdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDggPSBmdW5jdGlvbiByZWFkSW50OCAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDEsIHRoaXMubGVuZ3RoKVxuICBpZiAoISh0aGlzW29mZnNldF0gJiAweDgwKSkgcmV0dXJuICh0aGlzW29mZnNldF0pXG4gIHJldHVybiAoKDB4ZmYgLSB0aGlzW29mZnNldF0gKyAxKSAqIC0xKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWRJbnQxNkxFID0gZnVuY3Rpb24gcmVhZEludDE2TEUgKG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tPZmZzZXQob2Zmc2V0LCAyLCB0aGlzLmxlbmd0aClcbiAgdmFyIHZhbCA9IHRoaXNbb2Zmc2V0XSB8ICh0aGlzW29mZnNldCArIDFdIDw8IDgpXG4gIHJldHVybiAodmFsICYgMHg4MDAwKSA/IHZhbCB8IDB4RkZGRjAwMDAgOiB2YWxcbn1cblxuQnVmZmVyLnByb3RvdHlwZS5yZWFkSW50MTZCRSA9IGZ1bmN0aW9uIHJlYWRJbnQxNkJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgMiwgdGhpcy5sZW5ndGgpXG4gIHZhciB2YWwgPSB0aGlzW29mZnNldCArIDFdIHwgKHRoaXNbb2Zmc2V0XSA8PCA4KVxuICByZXR1cm4gKHZhbCAmIDB4ODAwMCkgPyB2YWwgfCAweEZGRkYwMDAwIDogdmFsXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyTEUgPSBmdW5jdGlvbiByZWFkSW50MzJMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdKSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgOCkgfFxuICAgICh0aGlzW29mZnNldCArIDJdIDw8IDE2KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10gPDwgMjQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEludDMyQkUgPSBmdW5jdGlvbiByZWFkSW50MzJCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuXG4gIHJldHVybiAodGhpc1tvZmZzZXRdIDw8IDI0KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgMV0gPDwgMTYpIHxcbiAgICAodGhpc1tvZmZzZXQgKyAyXSA8PCA4KSB8XG4gICAgKHRoaXNbb2Zmc2V0ICsgM10pXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0TEUgPSBmdW5jdGlvbiByZWFkRmxvYXRMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgMjMsIDQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZEZsb2F0QkUgPSBmdW5jdGlvbiByZWFkRmxvYXRCRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDQsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgZmFsc2UsIDIzLCA0KVxufVxuXG5CdWZmZXIucHJvdG90eXBlLnJlYWREb3VibGVMRSA9IGZ1bmN0aW9uIHJlYWREb3VibGVMRSAob2Zmc2V0LCBub0Fzc2VydCkge1xuICBpZiAoIW5vQXNzZXJ0KSBjaGVja09mZnNldChvZmZzZXQsIDgsIHRoaXMubGVuZ3RoKVxuICByZXR1cm4gaWVlZTc1NC5yZWFkKHRoaXMsIG9mZnNldCwgdHJ1ZSwgNTIsIDgpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUucmVhZERvdWJsZUJFID0gZnVuY3Rpb24gcmVhZERvdWJsZUJFIChvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrT2Zmc2V0KG9mZnNldCwgOCwgdGhpcy5sZW5ndGgpXG4gIHJldHVybiBpZWVlNzU0LnJlYWQodGhpcywgb2Zmc2V0LCBmYWxzZSwgNTIsIDgpXG59XG5cbmZ1bmN0aW9uIGNoZWNrSW50IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKCFCdWZmZXIuaXNCdWZmZXIoYnVmKSkgdGhyb3cgbmV3IFR5cGVFcnJvcignYnVmZmVyIG11c3QgYmUgYSBCdWZmZXIgaW5zdGFuY2UnKVxuICBpZiAodmFsdWUgPiBtYXggfHwgdmFsdWUgPCBtaW4pIHRocm93IG5ldyBSYW5nZUVycm9yKCd2YWx1ZSBpcyBvdXQgb2YgYm91bmRzJylcbiAgaWYgKG9mZnNldCArIGV4dCA+IGJ1Zi5sZW5ndGgpIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludExFID0gZnVuY3Rpb24gd3JpdGVVSW50TEUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgbXVsID0gMVxuICB2YXIgaSA9IDBcbiAgdGhpc1tvZmZzZXRdID0gdmFsdWUgJiAweEZGXG4gIHdoaWxlICgrK2kgPCBieXRlTGVuZ3RoICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludEJFID0gZnVuY3Rpb24gd3JpdGVVSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgYnl0ZUxlbmd0aCA9IGJ5dGVMZW5ndGggfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoKSwgMClcblxuICB2YXIgaSA9IGJ5dGVMZW5ndGggLSAxXG4gIHZhciBtdWwgPSAxXG4gIHRoaXNbb2Zmc2V0ICsgaV0gPSB2YWx1ZSAmIDB4RkZcbiAgd2hpbGUgKC0taSA+PSAwICYmIChtdWwgKj0gMHgxMDApKSB7XG4gICAgdGhpc1tvZmZzZXQgKyBpXSA9ICh2YWx1ZSAvIG11bCkgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlVUludDggPSBmdW5jdGlvbiB3cml0ZVVJbnQ4ICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICB2YWx1ZSA9ICt2YWx1ZVxuICBvZmZzZXQgPSBvZmZzZXQgfCAwXG4gIGlmICghbm9Bc3NlcnQpIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIDEsIDB4ZmYsIDApXG4gIGlmICghQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHZhbHVlID0gTWF0aC5mbG9vcih2YWx1ZSlcbiAgdGhpc1tvZmZzZXRdID0gKHZhbHVlICYgMHhmZilcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MTYgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmICsgdmFsdWUgKyAxXG4gIGZvciAodmFyIGkgPSAwLCBqID0gTWF0aC5taW4oYnVmLmxlbmd0aCAtIG9mZnNldCwgMik7IGkgPCBqOyBpKyspIHtcbiAgICBidWZbb2Zmc2V0ICsgaV0gPSAodmFsdWUgJiAoMHhmZiA8PCAoOCAqIChsaXR0bGVFbmRpYW4gPyBpIDogMSAtIGkpKSkpID4+PlxuICAgICAgKGxpdHRsZUVuZGlhbiA/IGkgOiAxIC0gaSkgKiA4XG4gIH1cbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQxNkxFID0gZnVuY3Rpb24gd3JpdGVVSW50MTZMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweGZmZmYsIDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSAmIDB4ZmYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlKVxuICB9XG4gIHJldHVybiBvZmZzZXQgKyAyXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlVUludDE2QkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHhmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDJcbn1cblxuZnVuY3Rpb24gb2JqZWN0V3JpdGVVSW50MzIgKGJ1ZiwgdmFsdWUsIG9mZnNldCwgbGl0dGxlRW5kaWFuKSB7XG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBmb3IgKHZhciBpID0gMCwgaiA9IE1hdGgubWluKGJ1Zi5sZW5ndGggLSBvZmZzZXQsIDQpOyBpIDwgajsgaSsrKSB7XG4gICAgYnVmW29mZnNldCArIGldID0gKHZhbHVlID4+PiAobGl0dGxlRW5kaWFuID8gaSA6IDMgLSBpKSAqIDgpICYgMHhmZlxuICB9XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVVSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlVUludDMyTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHhmZmZmZmZmZiwgMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSA+Pj4gMjQpXG4gICAgdGhpc1tvZmZzZXQgKyAyXSA9ICh2YWx1ZSA+Pj4gMTYpXG4gICAgdGhpc1tvZmZzZXQgKyAxXSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgJiAweGZmKVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZVVJbnQzMkJFID0gZnVuY3Rpb24gd3JpdGVVSW50MzJCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweGZmZmZmZmZmLCAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludExFID0gZnVuY3Rpb24gd3JpdGVJbnRMRSAodmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSB7XG4gICAgdmFyIGxpbWl0ID0gTWF0aC5wb3coMiwgOCAqIGJ5dGVMZW5ndGggLSAxKVxuXG4gICAgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgYnl0ZUxlbmd0aCwgbGltaXQgLSAxLCAtbGltaXQpXG4gIH1cblxuICB2YXIgaSA9IDBcbiAgdmFyIG11bCA9IDFcbiAgdmFyIHN1YiA9IHZhbHVlIDwgMCA/IDEgOiAwXG4gIHRoaXNbb2Zmc2V0XSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoKytpIDwgYnl0ZUxlbmd0aCAmJiAobXVsICo9IDB4MTAwKSkge1xuICAgIHRoaXNbb2Zmc2V0ICsgaV0gPSAoKHZhbHVlIC8gbXVsKSA+PiAwKSAtIHN1YiAmIDB4RkZcbiAgfVxuXG4gIHJldHVybiBvZmZzZXQgKyBieXRlTGVuZ3RoXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVJbnRCRSA9IGZ1bmN0aW9uIHdyaXRlSW50QkUgKHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIHZhciBsaW1pdCA9IE1hdGgucG93KDIsIDggKiBieXRlTGVuZ3RoIC0gMSlcblxuICAgIGNoZWNrSW50KHRoaXMsIHZhbHVlLCBvZmZzZXQsIGJ5dGVMZW5ndGgsIGxpbWl0IC0gMSwgLWxpbWl0KVxuICB9XG5cbiAgdmFyIGkgPSBieXRlTGVuZ3RoIC0gMVxuICB2YXIgbXVsID0gMVxuICB2YXIgc3ViID0gdmFsdWUgPCAwID8gMSA6IDBcbiAgdGhpc1tvZmZzZXQgKyBpXSA9IHZhbHVlICYgMHhGRlxuICB3aGlsZSAoLS1pID49IDAgJiYgKG11bCAqPSAweDEwMCkpIHtcbiAgICB0aGlzW29mZnNldCArIGldID0gKCh2YWx1ZSAvIG11bCkgPj4gMCkgLSBzdWIgJiAweEZGXG4gIH1cblxuICByZXR1cm4gb2Zmc2V0ICsgYnl0ZUxlbmd0aFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50OCA9IGZ1bmN0aW9uIHdyaXRlSW50OCAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAxLCAweDdmLCAtMHg4MClcbiAgaWYgKCFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkgdmFsdWUgPSBNYXRoLmZsb29yKHZhbHVlKVxuICBpZiAodmFsdWUgPCAwKSB2YWx1ZSA9IDB4ZmYgKyB2YWx1ZSArIDFcbiAgdGhpc1tvZmZzZXRdID0gKHZhbHVlICYgMHhmZilcbiAgcmV0dXJuIG9mZnNldCArIDFcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDE2TEUgPSBmdW5jdGlvbiB3cml0ZUludDE2TEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgMiwgMHg3ZmZmLCAtMHg4MDAwKVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgJiAweGZmKVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDgpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MTYodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MTZCRSA9IGZ1bmN0aW9uIHdyaXRlSW50MTZCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCAyLCAweDdmZmYsIC0weDgwMDApXG4gIGlmIChCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIHRoaXNbb2Zmc2V0XSA9ICh2YWx1ZSA+Pj4gOClcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlICYgMHhmZilcbiAgfSBlbHNlIHtcbiAgICBvYmplY3RXcml0ZVVJbnQxNih0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSlcbiAgfVxuICByZXR1cm4gb2Zmc2V0ICsgMlxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlSW50MzJMRSA9IGZ1bmN0aW9uIHdyaXRlSW50MzJMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgdmFsdWUgPSArdmFsdWVcbiAgb2Zmc2V0ID0gb2Zmc2V0IHwgMFxuICBpZiAoIW5vQXNzZXJ0KSBjaGVja0ludCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCA0LCAweDdmZmZmZmZmLCAtMHg4MDAwMDAwMClcbiAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgdGhpc1tvZmZzZXRdID0gKHZhbHVlICYgMHhmZilcbiAgICB0aGlzW29mZnNldCArIDFdID0gKHZhbHVlID4+PiA4KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgM10gPSAodmFsdWUgPj4+IDI0KVxuICB9IGVsc2Uge1xuICAgIG9iamVjdFdyaXRlVUludDMyKHRoaXMsIHZhbHVlLCBvZmZzZXQsIHRydWUpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZUludDMyQkUgPSBmdW5jdGlvbiB3cml0ZUludDMyQkUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHZhbHVlID0gK3ZhbHVlXG4gIG9mZnNldCA9IG9mZnNldCB8IDBcbiAgaWYgKCFub0Fzc2VydCkgY2hlY2tJbnQodGhpcywgdmFsdWUsIG9mZnNldCwgNCwgMHg3ZmZmZmZmZiwgLTB4ODAwMDAwMDApXG4gIGlmICh2YWx1ZSA8IDApIHZhbHVlID0gMHhmZmZmZmZmZiArIHZhbHVlICsgMVxuICBpZiAoQnVmZmVyLlRZUEVEX0FSUkFZX1NVUFBPUlQpIHtcbiAgICB0aGlzW29mZnNldF0gPSAodmFsdWUgPj4+IDI0KVxuICAgIHRoaXNbb2Zmc2V0ICsgMV0gPSAodmFsdWUgPj4+IDE2KVxuICAgIHRoaXNbb2Zmc2V0ICsgMl0gPSAodmFsdWUgPj4+IDgpXG4gICAgdGhpc1tvZmZzZXQgKyAzXSA9ICh2YWx1ZSAmIDB4ZmYpXG4gIH0gZWxzZSB7XG4gICAgb2JqZWN0V3JpdGVVSW50MzIodGhpcywgdmFsdWUsIG9mZnNldCwgZmFsc2UpXG4gIH1cbiAgcmV0dXJuIG9mZnNldCArIDRcbn1cblxuZnVuY3Rpb24gY2hlY2tJRUVFNzU0IChidWYsIHZhbHVlLCBvZmZzZXQsIGV4dCwgbWF4LCBtaW4pIHtcbiAgaWYgKHZhbHVlID4gbWF4IHx8IHZhbHVlIDwgbWluKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcigndmFsdWUgaXMgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChvZmZzZXQgKyBleHQgPiBidWYubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignaW5kZXggb3V0IG9mIHJhbmdlJylcbiAgaWYgKG9mZnNldCA8IDApIHRocm93IG5ldyBSYW5nZUVycm9yKCdpbmRleCBvdXQgb2YgcmFuZ2UnKVxufVxuXG5mdW5jdGlvbiB3cml0ZUZsb2F0IChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDQsIDMuNDAyODIzNDY2Mzg1Mjg4NmUrMzgsIC0zLjQwMjgyMzQ2NjM4NTI4ODZlKzM4KVxuICB9XG4gIGllZWU3NTQud3JpdGUoYnVmLCB2YWx1ZSwgb2Zmc2V0LCBsaXR0bGVFbmRpYW4sIDIzLCA0KVxuICByZXR1cm4gb2Zmc2V0ICsgNFxufVxuXG5CdWZmZXIucHJvdG90eXBlLndyaXRlRmxvYXRMRSA9IGZ1bmN0aW9uIHdyaXRlRmxvYXRMRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRmxvYXQodGhpcywgdmFsdWUsIG9mZnNldCwgdHJ1ZSwgbm9Bc3NlcnQpXG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVGbG9hdEJFID0gZnVuY3Rpb24gd3JpdGVGbG9hdEJFICh2YWx1ZSwgb2Zmc2V0LCBub0Fzc2VydCkge1xuICByZXR1cm4gd3JpdGVGbG9hdCh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCBmYWxzZSwgbm9Bc3NlcnQpXG59XG5cbmZ1bmN0aW9uIHdyaXRlRG91YmxlIChidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgbm9Bc3NlcnQpIHtcbiAgaWYgKCFub0Fzc2VydCkge1xuICAgIGNoZWNrSUVFRTc1NChidWYsIHZhbHVlLCBvZmZzZXQsIDgsIDEuNzk3NjkzMTM0ODYyMzE1N0UrMzA4LCAtMS43OTc2OTMxMzQ4NjIzMTU3RSszMDgpXG4gIH1cbiAgaWVlZTc1NC53cml0ZShidWYsIHZhbHVlLCBvZmZzZXQsIGxpdHRsZUVuZGlhbiwgNTIsIDgpXG4gIHJldHVybiBvZmZzZXQgKyA4XG59XG5cbkJ1ZmZlci5wcm90b3R5cGUud3JpdGVEb3VibGVMRSA9IGZ1bmN0aW9uIHdyaXRlRG91YmxlTEUgKHZhbHVlLCBvZmZzZXQsIG5vQXNzZXJ0KSB7XG4gIHJldHVybiB3cml0ZURvdWJsZSh0aGlzLCB2YWx1ZSwgb2Zmc2V0LCB0cnVlLCBub0Fzc2VydClcbn1cblxuQnVmZmVyLnByb3RvdHlwZS53cml0ZURvdWJsZUJFID0gZnVuY3Rpb24gd3JpdGVEb3VibGVCRSAodmFsdWUsIG9mZnNldCwgbm9Bc3NlcnQpIHtcbiAgcmV0dXJuIHdyaXRlRG91YmxlKHRoaXMsIHZhbHVlLCBvZmZzZXQsIGZhbHNlLCBub0Fzc2VydClcbn1cblxuLy8gY29weSh0YXJnZXRCdWZmZXIsIHRhcmdldFN0YXJ0PTAsIHNvdXJjZVN0YXJ0PTAsIHNvdXJjZUVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5jb3B5ID0gZnVuY3Rpb24gY29weSAodGFyZ2V0LCB0YXJnZXRTdGFydCwgc3RhcnQsIGVuZCkge1xuICBpZiAoIXN0YXJ0KSBzdGFydCA9IDBcbiAgaWYgKCFlbmQgJiYgZW5kICE9PSAwKSBlbmQgPSB0aGlzLmxlbmd0aFxuICBpZiAodGFyZ2V0U3RhcnQgPj0gdGFyZ2V0Lmxlbmd0aCkgdGFyZ2V0U3RhcnQgPSB0YXJnZXQubGVuZ3RoXG4gIGlmICghdGFyZ2V0U3RhcnQpIHRhcmdldFN0YXJ0ID0gMFxuICBpZiAoZW5kID4gMCAmJiBlbmQgPCBzdGFydCkgZW5kID0gc3RhcnRcblxuICAvLyBDb3B5IDAgYnl0ZXM7IHdlJ3JlIGRvbmVcbiAgaWYgKGVuZCA9PT0gc3RhcnQpIHJldHVybiAwXG4gIGlmICh0YXJnZXQubGVuZ3RoID09PSAwIHx8IHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm4gMFxuXG4gIC8vIEZhdGFsIGVycm9yIGNvbmRpdGlvbnNcbiAgaWYgKHRhcmdldFN0YXJ0IDwgMCkge1xuICAgIHRocm93IG5ldyBSYW5nZUVycm9yKCd0YXJnZXRTdGFydCBvdXQgb2YgYm91bmRzJylcbiAgfVxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlU3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc291cmNlRW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIC8vIEFyZSB3ZSBvb2I/XG4gIGlmIChlbmQgPiB0aGlzLmxlbmd0aCkgZW5kID0gdGhpcy5sZW5ndGhcbiAgaWYgKHRhcmdldC5sZW5ndGggLSB0YXJnZXRTdGFydCA8IGVuZCAtIHN0YXJ0KSB7XG4gICAgZW5kID0gdGFyZ2V0Lmxlbmd0aCAtIHRhcmdldFN0YXJ0ICsgc3RhcnRcbiAgfVxuXG4gIHZhciBsZW4gPSBlbmQgLSBzdGFydFxuICB2YXIgaVxuXG4gIGlmICh0aGlzID09PSB0YXJnZXQgJiYgc3RhcnQgPCB0YXJnZXRTdGFydCAmJiB0YXJnZXRTdGFydCA8IGVuZCkge1xuICAgIC8vIGRlc2NlbmRpbmcgY29weSBmcm9tIGVuZFxuICAgIGZvciAoaSA9IGxlbiAtIDE7IGkgPj0gMDsgaS0tKSB7XG4gICAgICB0YXJnZXRbaSArIHRhcmdldFN0YXJ0XSA9IHRoaXNbaSArIHN0YXJ0XVxuICAgIH1cbiAgfSBlbHNlIGlmIChsZW4gPCAxMDAwIHx8ICFCdWZmZXIuVFlQRURfQVJSQVlfU1VQUE9SVCkge1xuICAgIC8vIGFzY2VuZGluZyBjb3B5IGZyb20gc3RhcnRcbiAgICBmb3IgKGkgPSAwOyBpIDwgbGVuOyBpKyspIHtcbiAgICAgIHRhcmdldFtpICsgdGFyZ2V0U3RhcnRdID0gdGhpc1tpICsgc3RhcnRdXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRhcmdldC5fc2V0KHRoaXMuc3ViYXJyYXkoc3RhcnQsIHN0YXJ0ICsgbGVuKSwgdGFyZ2V0U3RhcnQpXG4gIH1cblxuICByZXR1cm4gbGVuXG59XG5cbi8vIGZpbGwodmFsdWUsIHN0YXJ0PTAsIGVuZD1idWZmZXIubGVuZ3RoKVxuQnVmZmVyLnByb3RvdHlwZS5maWxsID0gZnVuY3Rpb24gZmlsbCAodmFsdWUsIHN0YXJ0LCBlbmQpIHtcbiAgaWYgKCF2YWx1ZSkgdmFsdWUgPSAwXG4gIGlmICghc3RhcnQpIHN0YXJ0ID0gMFxuICBpZiAoIWVuZCkgZW5kID0gdGhpcy5sZW5ndGhcblxuICBpZiAoZW5kIDwgc3RhcnQpIHRocm93IG5ldyBSYW5nZUVycm9yKCdlbmQgPCBzdGFydCcpXG5cbiAgLy8gRmlsbCAwIGJ5dGVzOyB3ZSdyZSBkb25lXG4gIGlmIChlbmQgPT09IHN0YXJ0KSByZXR1cm5cbiAgaWYgKHRoaXMubGVuZ3RoID09PSAwKSByZXR1cm5cblxuICBpZiAoc3RhcnQgPCAwIHx8IHN0YXJ0ID49IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignc3RhcnQgb3V0IG9mIGJvdW5kcycpXG4gIGlmIChlbmQgPCAwIHx8IGVuZCA+IHRoaXMubGVuZ3RoKSB0aHJvdyBuZXcgUmFuZ2VFcnJvcignZW5kIG91dCBvZiBib3VuZHMnKVxuXG4gIHZhciBpXG4gIGlmICh0eXBlb2YgdmFsdWUgPT09ICdudW1iZXInKSB7XG4gICAgZm9yIChpID0gc3RhcnQ7IGkgPCBlbmQ7IGkrKykge1xuICAgICAgdGhpc1tpXSA9IHZhbHVlXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHZhciBieXRlcyA9IHV0ZjhUb0J5dGVzKHZhbHVlLnRvU3RyaW5nKCkpXG4gICAgdmFyIGxlbiA9IGJ5dGVzLmxlbmd0aFxuICAgIGZvciAoaSA9IHN0YXJ0OyBpIDwgZW5kOyBpKyspIHtcbiAgICAgIHRoaXNbaV0gPSBieXRlc1tpICUgbGVuXVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiB0aGlzXG59XG5cbi8qKlxuICogQ3JlYXRlcyBhIG5ldyBgQXJyYXlCdWZmZXJgIHdpdGggdGhlICpjb3BpZWQqIG1lbW9yeSBvZiB0aGUgYnVmZmVyIGluc3RhbmNlLlxuICogQWRkZWQgaW4gTm9kZSAwLjEyLiBPbmx5IGF2YWlsYWJsZSBpbiBicm93c2VycyB0aGF0IHN1cHBvcnQgQXJyYXlCdWZmZXIuXG4gKi9cbkJ1ZmZlci5wcm90b3R5cGUudG9BcnJheUJ1ZmZlciA9IGZ1bmN0aW9uIHRvQXJyYXlCdWZmZXIgKCkge1xuICBpZiAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKSB7XG4gICAgaWYgKEJ1ZmZlci5UWVBFRF9BUlJBWV9TVVBQT1JUKSB7XG4gICAgICByZXR1cm4gKG5ldyBCdWZmZXIodGhpcykpLmJ1ZmZlclxuICAgIH0gZWxzZSB7XG4gICAgICB2YXIgYnVmID0gbmV3IFVpbnQ4QXJyYXkodGhpcy5sZW5ndGgpXG4gICAgICBmb3IgKHZhciBpID0gMCwgbGVuID0gYnVmLmxlbmd0aDsgaSA8IGxlbjsgaSArPSAxKSB7XG4gICAgICAgIGJ1ZltpXSA9IHRoaXNbaV1cbiAgICAgIH1cbiAgICAgIHJldHVybiBidWYuYnVmZmVyXG4gICAgfVxuICB9IGVsc2Uge1xuICAgIHRocm93IG5ldyBUeXBlRXJyb3IoJ0J1ZmZlci50b0FycmF5QnVmZmVyIG5vdCBzdXBwb3J0ZWQgaW4gdGhpcyBicm93c2VyJylcbiAgfVxufVxuXG4vLyBIRUxQRVIgRlVOQ1RJT05TXG4vLyA9PT09PT09PT09PT09PT09XG5cbnZhciBCUCA9IEJ1ZmZlci5wcm90b3R5cGVcblxuLyoqXG4gKiBBdWdtZW50IGEgVWludDhBcnJheSAqaW5zdGFuY2UqIChub3QgdGhlIFVpbnQ4QXJyYXkgY2xhc3MhKSB3aXRoIEJ1ZmZlciBtZXRob2RzXG4gKi9cbkJ1ZmZlci5fYXVnbWVudCA9IGZ1bmN0aW9uIF9hdWdtZW50IChhcnIpIHtcbiAgYXJyLmNvbnN0cnVjdG9yID0gQnVmZmVyXG4gIGFyci5faXNCdWZmZXIgPSB0cnVlXG5cbiAgLy8gc2F2ZSByZWZlcmVuY2UgdG8gb3JpZ2luYWwgVWludDhBcnJheSBzZXQgbWV0aG9kIGJlZm9yZSBvdmVyd3JpdGluZ1xuICBhcnIuX3NldCA9IGFyci5zZXRcblxuICAvLyBkZXByZWNhdGVkXG4gIGFyci5nZXQgPSBCUC5nZXRcbiAgYXJyLnNldCA9IEJQLnNldFxuXG4gIGFyci53cml0ZSA9IEJQLndyaXRlXG4gIGFyci50b1N0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0xvY2FsZVN0cmluZyA9IEJQLnRvU3RyaW5nXG4gIGFyci50b0pTT04gPSBCUC50b0pTT05cbiAgYXJyLmVxdWFscyA9IEJQLmVxdWFsc1xuICBhcnIuY29tcGFyZSA9IEJQLmNvbXBhcmVcbiAgYXJyLmluZGV4T2YgPSBCUC5pbmRleE9mXG4gIGFyci5jb3B5ID0gQlAuY29weVxuICBhcnIuc2xpY2UgPSBCUC5zbGljZVxuICBhcnIucmVhZFVJbnRMRSA9IEJQLnJlYWRVSW50TEVcbiAgYXJyLnJlYWRVSW50QkUgPSBCUC5yZWFkVUludEJFXG4gIGFyci5yZWFkVUludDggPSBCUC5yZWFkVUludDhcbiAgYXJyLnJlYWRVSW50MTZMRSA9IEJQLnJlYWRVSW50MTZMRVxuICBhcnIucmVhZFVJbnQxNkJFID0gQlAucmVhZFVJbnQxNkJFXG4gIGFyci5yZWFkVUludDMyTEUgPSBCUC5yZWFkVUludDMyTEVcbiAgYXJyLnJlYWRVSW50MzJCRSA9IEJQLnJlYWRVSW50MzJCRVxuICBhcnIucmVhZEludExFID0gQlAucmVhZEludExFXG4gIGFyci5yZWFkSW50QkUgPSBCUC5yZWFkSW50QkVcbiAgYXJyLnJlYWRJbnQ4ID0gQlAucmVhZEludDhcbiAgYXJyLnJlYWRJbnQxNkxFID0gQlAucmVhZEludDE2TEVcbiAgYXJyLnJlYWRJbnQxNkJFID0gQlAucmVhZEludDE2QkVcbiAgYXJyLnJlYWRJbnQzMkxFID0gQlAucmVhZEludDMyTEVcbiAgYXJyLnJlYWRJbnQzMkJFID0gQlAucmVhZEludDMyQkVcbiAgYXJyLnJlYWRGbG9hdExFID0gQlAucmVhZEZsb2F0TEVcbiAgYXJyLnJlYWRGbG9hdEJFID0gQlAucmVhZEZsb2F0QkVcbiAgYXJyLnJlYWREb3VibGVMRSA9IEJQLnJlYWREb3VibGVMRVxuICBhcnIucmVhZERvdWJsZUJFID0gQlAucmVhZERvdWJsZUJFXG4gIGFyci53cml0ZVVJbnQ4ID0gQlAud3JpdGVVSW50OFxuICBhcnIud3JpdGVVSW50TEUgPSBCUC53cml0ZVVJbnRMRVxuICBhcnIud3JpdGVVSW50QkUgPSBCUC53cml0ZVVJbnRCRVxuICBhcnIud3JpdGVVSW50MTZMRSA9IEJQLndyaXRlVUludDE2TEVcbiAgYXJyLndyaXRlVUludDE2QkUgPSBCUC53cml0ZVVJbnQxNkJFXG4gIGFyci53cml0ZVVJbnQzMkxFID0gQlAud3JpdGVVSW50MzJMRVxuICBhcnIud3JpdGVVSW50MzJCRSA9IEJQLndyaXRlVUludDMyQkVcbiAgYXJyLndyaXRlSW50TEUgPSBCUC53cml0ZUludExFXG4gIGFyci53cml0ZUludEJFID0gQlAud3JpdGVJbnRCRVxuICBhcnIud3JpdGVJbnQ4ID0gQlAud3JpdGVJbnQ4XG4gIGFyci53cml0ZUludDE2TEUgPSBCUC53cml0ZUludDE2TEVcbiAgYXJyLndyaXRlSW50MTZCRSA9IEJQLndyaXRlSW50MTZCRVxuICBhcnIud3JpdGVJbnQzMkxFID0gQlAud3JpdGVJbnQzMkxFXG4gIGFyci53cml0ZUludDMyQkUgPSBCUC53cml0ZUludDMyQkVcbiAgYXJyLndyaXRlRmxvYXRMRSA9IEJQLndyaXRlRmxvYXRMRVxuICBhcnIud3JpdGVGbG9hdEJFID0gQlAud3JpdGVGbG9hdEJFXG4gIGFyci53cml0ZURvdWJsZUxFID0gQlAud3JpdGVEb3VibGVMRVxuICBhcnIud3JpdGVEb3VibGVCRSA9IEJQLndyaXRlRG91YmxlQkVcbiAgYXJyLmZpbGwgPSBCUC5maWxsXG4gIGFyci5pbnNwZWN0ID0gQlAuaW5zcGVjdFxuICBhcnIudG9BcnJheUJ1ZmZlciA9IEJQLnRvQXJyYXlCdWZmZXJcblxuICByZXR1cm4gYXJyXG59XG5cbnZhciBJTlZBTElEX0JBU0U2NF9SRSA9IC9bXitcXC8wLTlBLVphLXotX10vZ1xuXG5mdW5jdGlvbiBiYXNlNjRjbGVhbiAoc3RyKSB7XG4gIC8vIE5vZGUgc3RyaXBzIG91dCBpbnZhbGlkIGNoYXJhY3RlcnMgbGlrZSBcXG4gYW5kIFxcdCBmcm9tIHRoZSBzdHJpbmcsIGJhc2U2NC1qcyBkb2VzIG5vdFxuICBzdHIgPSBzdHJpbmd0cmltKHN0cikucmVwbGFjZShJTlZBTElEX0JBU0U2NF9SRSwgJycpXG4gIC8vIE5vZGUgY29udmVydHMgc3RyaW5ncyB3aXRoIGxlbmd0aCA8IDIgdG8gJydcbiAgaWYgKHN0ci5sZW5ndGggPCAyKSByZXR1cm4gJydcbiAgLy8gTm9kZSBhbGxvd3MgZm9yIG5vbi1wYWRkZWQgYmFzZTY0IHN0cmluZ3MgKG1pc3NpbmcgdHJhaWxpbmcgPT09KSwgYmFzZTY0LWpzIGRvZXMgbm90XG4gIHdoaWxlIChzdHIubGVuZ3RoICUgNCAhPT0gMCkge1xuICAgIHN0ciA9IHN0ciArICc9J1xuICB9XG4gIHJldHVybiBzdHJcbn1cblxuZnVuY3Rpb24gc3RyaW5ndHJpbSAoc3RyKSB7XG4gIGlmIChzdHIudHJpbSkgcmV0dXJuIHN0ci50cmltKClcbiAgcmV0dXJuIHN0ci5yZXBsYWNlKC9eXFxzK3xcXHMrJC9nLCAnJylcbn1cblxuZnVuY3Rpb24gdG9IZXggKG4pIHtcbiAgaWYgKG4gPCAxNikgcmV0dXJuICcwJyArIG4udG9TdHJpbmcoMTYpXG4gIHJldHVybiBuLnRvU3RyaW5nKDE2KVxufVxuXG5mdW5jdGlvbiB1dGY4VG9CeXRlcyAoc3RyaW5nLCB1bml0cykge1xuICB1bml0cyA9IHVuaXRzIHx8IEluZmluaXR5XG4gIHZhciBjb2RlUG9pbnRcbiAgdmFyIGxlbmd0aCA9IHN0cmluZy5sZW5ndGhcbiAgdmFyIGxlYWRTdXJyb2dhdGUgPSBudWxsXG4gIHZhciBieXRlcyA9IFtdXG5cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBsZW5ndGg7IGkrKykge1xuICAgIGNvZGVQb2ludCA9IHN0cmluZy5jaGFyQ29kZUF0KGkpXG5cbiAgICAvLyBpcyBzdXJyb2dhdGUgY29tcG9uZW50XG4gICAgaWYgKGNvZGVQb2ludCA+IDB4RDdGRiAmJiBjb2RlUG9pbnQgPCAweEUwMDApIHtcbiAgICAgIC8vIGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAoIWxlYWRTdXJyb2dhdGUpIHtcbiAgICAgICAgLy8gbm8gbGVhZCB5ZXRcbiAgICAgICAgaWYgKGNvZGVQb2ludCA+IDB4REJGRikge1xuICAgICAgICAgIC8vIHVuZXhwZWN0ZWQgdHJhaWxcbiAgICAgICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICAgICAgICBjb250aW51ZVxuICAgICAgICB9IGVsc2UgaWYgKGkgKyAxID09PSBsZW5ndGgpIHtcbiAgICAgICAgICAvLyB1bnBhaXJlZCBsZWFkXG4gICAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgICAgY29udGludWVcbiAgICAgICAgfVxuXG4gICAgICAgIC8vIHZhbGlkIGxlYWRcbiAgICAgICAgbGVhZFN1cnJvZ2F0ZSA9IGNvZGVQb2ludFxuXG4gICAgICAgIGNvbnRpbnVlXG4gICAgICB9XG5cbiAgICAgIC8vIDIgbGVhZHMgaW4gYSByb3dcbiAgICAgIGlmIChjb2RlUG9pbnQgPCAweERDMDApIHtcbiAgICAgICAgaWYgKCh1bml0cyAtPSAzKSA+IC0xKSBieXRlcy5wdXNoKDB4RUYsIDB4QkYsIDB4QkQpXG4gICAgICAgIGxlYWRTdXJyb2dhdGUgPSBjb2RlUG9pbnRcbiAgICAgICAgY29udGludWVcbiAgICAgIH1cblxuICAgICAgLy8gdmFsaWQgc3Vycm9nYXRlIHBhaXJcbiAgICAgIGNvZGVQb2ludCA9IGxlYWRTdXJyb2dhdGUgLSAweEQ4MDAgPDwgMTAgfCBjb2RlUG9pbnQgLSAweERDMDAgfCAweDEwMDAwXG4gICAgfSBlbHNlIGlmIChsZWFkU3Vycm9nYXRlKSB7XG4gICAgICAvLyB2YWxpZCBibXAgY2hhciwgYnV0IGxhc3QgY2hhciB3YXMgYSBsZWFkXG4gICAgICBpZiAoKHVuaXRzIC09IDMpID4gLTEpIGJ5dGVzLnB1c2goMHhFRiwgMHhCRiwgMHhCRClcbiAgICB9XG5cbiAgICBsZWFkU3Vycm9nYXRlID0gbnVsbFxuXG4gICAgLy8gZW5jb2RlIHV0ZjhcbiAgICBpZiAoY29kZVBvaW50IDwgMHg4MCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAxKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKGNvZGVQb2ludClcbiAgICB9IGVsc2UgaWYgKGNvZGVQb2ludCA8IDB4ODAwKSB7XG4gICAgICBpZiAoKHVuaXRzIC09IDIpIDwgMCkgYnJlYWtcbiAgICAgIGJ5dGVzLnB1c2goXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgfCAweEMwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHgxMDAwMCkge1xuICAgICAgaWYgKCh1bml0cyAtPSAzKSA8IDApIGJyZWFrXG4gICAgICBieXRlcy5wdXNoKFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHhDIHwgMHhFMCxcbiAgICAgICAgY29kZVBvaW50ID4+IDB4NiAmIDB4M0YgfCAweDgwLFxuICAgICAgICBjb2RlUG9pbnQgJiAweDNGIHwgMHg4MFxuICAgICAgKVxuICAgIH0gZWxzZSBpZiAoY29kZVBvaW50IDwgMHgxMTAwMDApIHtcbiAgICAgIGlmICgodW5pdHMgLT0gNCkgPCAwKSBicmVha1xuICAgICAgYnl0ZXMucHVzaChcbiAgICAgICAgY29kZVBvaW50ID4+IDB4MTIgfCAweEYwLFxuICAgICAgICBjb2RlUG9pbnQgPj4gMHhDICYgMHgzRiB8IDB4ODAsXG4gICAgICAgIGNvZGVQb2ludCA+PiAweDYgJiAweDNGIHwgMHg4MCxcbiAgICAgICAgY29kZVBvaW50ICYgMHgzRiB8IDB4ODBcbiAgICAgIClcbiAgICB9IGVsc2Uge1xuICAgICAgdGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIGNvZGUgcG9pbnQnKVxuICAgIH1cbiAgfVxuXG4gIHJldHVybiBieXRlc1xufVxuXG5mdW5jdGlvbiBhc2NpaVRvQnl0ZXMgKHN0cikge1xuICB2YXIgYnl0ZUFycmF5ID0gW11cbiAgZm9yICh2YXIgaSA9IDA7IGkgPCBzdHIubGVuZ3RoOyBpKyspIHtcbiAgICAvLyBOb2RlJ3MgY29kZSBzZWVtcyB0byBiZSBkb2luZyB0aGlzIGFuZCBub3QgJiAweDdGLi5cbiAgICBieXRlQXJyYXkucHVzaChzdHIuY2hhckNvZGVBdChpKSAmIDB4RkYpXG4gIH1cbiAgcmV0dXJuIGJ5dGVBcnJheVxufVxuXG5mdW5jdGlvbiB1dGYxNmxlVG9CeXRlcyAoc3RyLCB1bml0cykge1xuICB2YXIgYywgaGksIGxvXG4gIHZhciBieXRlQXJyYXkgPSBbXVxuICBmb3IgKHZhciBpID0gMDsgaSA8IHN0ci5sZW5ndGg7IGkrKykge1xuICAgIGlmICgodW5pdHMgLT0gMikgPCAwKSBicmVha1xuXG4gICAgYyA9IHN0ci5jaGFyQ29kZUF0KGkpXG4gICAgaGkgPSBjID4+IDhcbiAgICBsbyA9IGMgJSAyNTZcbiAgICBieXRlQXJyYXkucHVzaChsbylcbiAgICBieXRlQXJyYXkucHVzaChoaSlcbiAgfVxuXG4gIHJldHVybiBieXRlQXJyYXlcbn1cblxuZnVuY3Rpb24gYmFzZTY0VG9CeXRlcyAoc3RyKSB7XG4gIHJldHVybiBiYXNlNjQudG9CeXRlQXJyYXkoYmFzZTY0Y2xlYW4oc3RyKSlcbn1cblxuZnVuY3Rpb24gYmxpdEJ1ZmZlciAoc3JjLCBkc3QsIG9mZnNldCwgbGVuZ3RoKSB7XG4gIGZvciAodmFyIGkgPSAwOyBpIDwgbGVuZ3RoOyBpKyspIHtcbiAgICBpZiAoKGkgKyBvZmZzZXQgPj0gZHN0Lmxlbmd0aCkgfHwgKGkgPj0gc3JjLmxlbmd0aCkpIGJyZWFrXG4gICAgZHN0W2kgKyBvZmZzZXRdID0gc3JjW2ldXG4gIH1cbiAgcmV0dXJuIGlcbn1cbiIsInZhciBsb29rdXAgPSAnQUJDREVGR0hJSktMTU5PUFFSU1RVVldYWVphYmNkZWZnaGlqa2xtbm9wcXJzdHV2d3h5ejAxMjM0NTY3ODkrLyc7XG5cbjsoZnVuY3Rpb24gKGV4cG9ydHMpIHtcblx0J3VzZSBzdHJpY3QnO1xuXG4gIHZhciBBcnIgPSAodHlwZW9mIFVpbnQ4QXJyYXkgIT09ICd1bmRlZmluZWQnKVxuICAgID8gVWludDhBcnJheVxuICAgIDogQXJyYXlcblxuXHR2YXIgUExVUyAgID0gJysnLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIICA9ICcvJy5jaGFyQ29kZUF0KDApXG5cdHZhciBOVU1CRVIgPSAnMCcuY2hhckNvZGVBdCgwKVxuXHR2YXIgTE9XRVIgID0gJ2EnLmNoYXJDb2RlQXQoMClcblx0dmFyIFVQUEVSICA9ICdBJy5jaGFyQ29kZUF0KDApXG5cdHZhciBQTFVTX1VSTF9TQUZFID0gJy0nLmNoYXJDb2RlQXQoMClcblx0dmFyIFNMQVNIX1VSTF9TQUZFID0gJ18nLmNoYXJDb2RlQXQoMClcblxuXHRmdW5jdGlvbiBkZWNvZGUgKGVsdCkge1xuXHRcdHZhciBjb2RlID0gZWx0LmNoYXJDb2RlQXQoMClcblx0XHRpZiAoY29kZSA9PT0gUExVUyB8fFxuXHRcdCAgICBjb2RlID09PSBQTFVTX1VSTF9TQUZFKVxuXHRcdFx0cmV0dXJuIDYyIC8vICcrJ1xuXHRcdGlmIChjb2RlID09PSBTTEFTSCB8fFxuXHRcdCAgICBjb2RlID09PSBTTEFTSF9VUkxfU0FGRSlcblx0XHRcdHJldHVybiA2MyAvLyAnLydcblx0XHRpZiAoY29kZSA8IE5VTUJFUilcblx0XHRcdHJldHVybiAtMSAvL25vIG1hdGNoXG5cdFx0aWYgKGNvZGUgPCBOVU1CRVIgKyAxMClcblx0XHRcdHJldHVybiBjb2RlIC0gTlVNQkVSICsgMjYgKyAyNlxuXHRcdGlmIChjb2RlIDwgVVBQRVIgKyAyNilcblx0XHRcdHJldHVybiBjb2RlIC0gVVBQRVJcblx0XHRpZiAoY29kZSA8IExPV0VSICsgMjYpXG5cdFx0XHRyZXR1cm4gY29kZSAtIExPV0VSICsgMjZcblx0fVxuXG5cdGZ1bmN0aW9uIGI2NFRvQnl0ZUFycmF5IChiNjQpIHtcblx0XHR2YXIgaSwgaiwgbCwgdG1wLCBwbGFjZUhvbGRlcnMsIGFyclxuXG5cdFx0aWYgKGI2NC5sZW5ndGggJSA0ID4gMCkge1xuXHRcdFx0dGhyb3cgbmV3IEVycm9yKCdJbnZhbGlkIHN0cmluZy4gTGVuZ3RoIG11c3QgYmUgYSBtdWx0aXBsZSBvZiA0Jylcblx0XHR9XG5cblx0XHQvLyB0aGUgbnVtYmVyIG9mIGVxdWFsIHNpZ25zIChwbGFjZSBob2xkZXJzKVxuXHRcdC8vIGlmIHRoZXJlIGFyZSB0d28gcGxhY2Vob2xkZXJzLCB0aGFuIHRoZSB0d28gY2hhcmFjdGVycyBiZWZvcmUgaXRcblx0XHQvLyByZXByZXNlbnQgb25lIGJ5dGVcblx0XHQvLyBpZiB0aGVyZSBpcyBvbmx5IG9uZSwgdGhlbiB0aGUgdGhyZWUgY2hhcmFjdGVycyBiZWZvcmUgaXQgcmVwcmVzZW50IDIgYnl0ZXNcblx0XHQvLyB0aGlzIGlzIGp1c3QgYSBjaGVhcCBoYWNrIHRvIG5vdCBkbyBpbmRleE9mIHR3aWNlXG5cdFx0dmFyIGxlbiA9IGI2NC5sZW5ndGhcblx0XHRwbGFjZUhvbGRlcnMgPSAnPScgPT09IGI2NC5jaGFyQXQobGVuIC0gMikgPyAyIDogJz0nID09PSBiNjQuY2hhckF0KGxlbiAtIDEpID8gMSA6IDBcblxuXHRcdC8vIGJhc2U2NCBpcyA0LzMgKyB1cCB0byB0d28gY2hhcmFjdGVycyBvZiB0aGUgb3JpZ2luYWwgZGF0YVxuXHRcdGFyciA9IG5ldyBBcnIoYjY0Lmxlbmd0aCAqIDMgLyA0IC0gcGxhY2VIb2xkZXJzKVxuXG5cdFx0Ly8gaWYgdGhlcmUgYXJlIHBsYWNlaG9sZGVycywgb25seSBnZXQgdXAgdG8gdGhlIGxhc3QgY29tcGxldGUgNCBjaGFyc1xuXHRcdGwgPSBwbGFjZUhvbGRlcnMgPiAwID8gYjY0Lmxlbmd0aCAtIDQgOiBiNjQubGVuZ3RoXG5cblx0XHR2YXIgTCA9IDBcblxuXHRcdGZ1bmN0aW9uIHB1c2ggKHYpIHtcblx0XHRcdGFycltMKytdID0gdlxuXHRcdH1cblxuXHRcdGZvciAoaSA9IDAsIGogPSAwOyBpIDwgbDsgaSArPSA0LCBqICs9IDMpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTgpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgMTIpIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAyKSkgPDwgNikgfCBkZWNvZGUoYjY0LmNoYXJBdChpICsgMykpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDAwMCkgPj4gMTYpXG5cdFx0XHRwdXNoKCh0bXAgJiAweEZGMDApID4+IDgpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fVxuXG5cdFx0aWYgKHBsYWNlSG9sZGVycyA9PT0gMikge1xuXHRcdFx0dG1wID0gKGRlY29kZShiNjQuY2hhckF0KGkpKSA8PCAyKSB8IChkZWNvZGUoYjY0LmNoYXJBdChpICsgMSkpID4+IDQpXG5cdFx0XHRwdXNoKHRtcCAmIDB4RkYpXG5cdFx0fSBlbHNlIGlmIChwbGFjZUhvbGRlcnMgPT09IDEpIHtcblx0XHRcdHRtcCA9IChkZWNvZGUoYjY0LmNoYXJBdChpKSkgPDwgMTApIHwgKGRlY29kZShiNjQuY2hhckF0KGkgKyAxKSkgPDwgNCkgfCAoZGVjb2RlKGI2NC5jaGFyQXQoaSArIDIpKSA+PiAyKVxuXHRcdFx0cHVzaCgodG1wID4+IDgpICYgMHhGRilcblx0XHRcdHB1c2godG1wICYgMHhGRilcblx0XHR9XG5cblx0XHRyZXR1cm4gYXJyXG5cdH1cblxuXHRmdW5jdGlvbiB1aW50OFRvQmFzZTY0ICh1aW50OCkge1xuXHRcdHZhciBpLFxuXHRcdFx0ZXh0cmFCeXRlcyA9IHVpbnQ4Lmxlbmd0aCAlIDMsIC8vIGlmIHdlIGhhdmUgMSBieXRlIGxlZnQsIHBhZCAyIGJ5dGVzXG5cdFx0XHRvdXRwdXQgPSBcIlwiLFxuXHRcdFx0dGVtcCwgbGVuZ3RoXG5cblx0XHRmdW5jdGlvbiBlbmNvZGUgKG51bSkge1xuXHRcdFx0cmV0dXJuIGxvb2t1cC5jaGFyQXQobnVtKVxuXHRcdH1cblxuXHRcdGZ1bmN0aW9uIHRyaXBsZXRUb0Jhc2U2NCAobnVtKSB7XG5cdFx0XHRyZXR1cm4gZW5jb2RlKG51bSA+PiAxOCAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiAxMiAmIDB4M0YpICsgZW5jb2RlKG51bSA+PiA2ICYgMHgzRikgKyBlbmNvZGUobnVtICYgMHgzRilcblx0XHR9XG5cblx0XHQvLyBnbyB0aHJvdWdoIHRoZSBhcnJheSBldmVyeSB0aHJlZSBieXRlcywgd2UnbGwgZGVhbCB3aXRoIHRyYWlsaW5nIHN0dWZmIGxhdGVyXG5cdFx0Zm9yIChpID0gMCwgbGVuZ3RoID0gdWludDgubGVuZ3RoIC0gZXh0cmFCeXRlczsgaSA8IGxlbmd0aDsgaSArPSAzKSB7XG5cdFx0XHR0ZW1wID0gKHVpbnQ4W2ldIDw8IDE2KSArICh1aW50OFtpICsgMV0gPDwgOCkgKyAodWludDhbaSArIDJdKVxuXHRcdFx0b3V0cHV0ICs9IHRyaXBsZXRUb0Jhc2U2NCh0ZW1wKVxuXHRcdH1cblxuXHRcdC8vIHBhZCB0aGUgZW5kIHdpdGggemVyb3MsIGJ1dCBtYWtlIHN1cmUgdG8gbm90IGZvcmdldCB0aGUgZXh0cmEgYnl0ZXNcblx0XHRzd2l0Y2ggKGV4dHJhQnl0ZXMpIHtcblx0XHRcdGNhc2UgMTpcblx0XHRcdFx0dGVtcCA9IHVpbnQ4W3VpbnQ4Lmxlbmd0aCAtIDFdXG5cdFx0XHRcdG91dHB1dCArPSBlbmNvZGUodGVtcCA+PiAyKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wIDw8IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9ICc9PSdcblx0XHRcdFx0YnJlYWtcblx0XHRcdGNhc2UgMjpcblx0XHRcdFx0dGVtcCA9ICh1aW50OFt1aW50OC5sZW5ndGggLSAyXSA8PCA4KSArICh1aW50OFt1aW50OC5sZW5ndGggLSAxXSlcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSh0ZW1wID4+IDEwKVxuXHRcdFx0XHRvdXRwdXQgKz0gZW5jb2RlKCh0ZW1wID4+IDQpICYgMHgzRilcblx0XHRcdFx0b3V0cHV0ICs9IGVuY29kZSgodGVtcCA8PCAyKSAmIDB4M0YpXG5cdFx0XHRcdG91dHB1dCArPSAnPSdcblx0XHRcdFx0YnJlYWtcblx0XHR9XG5cblx0XHRyZXR1cm4gb3V0cHV0XG5cdH1cblxuXHRleHBvcnRzLnRvQnl0ZUFycmF5ID0gYjY0VG9CeXRlQXJyYXlcblx0ZXhwb3J0cy5mcm9tQnl0ZUFycmF5ID0gdWludDhUb0Jhc2U2NFxufSh0eXBlb2YgZXhwb3J0cyA9PT0gJ3VuZGVmaW5lZCcgPyAodGhpcy5iYXNlNjRqcyA9IHt9KSA6IGV4cG9ydHMpKVxuIiwiZXhwb3J0cy5yZWFkID0gZnVuY3Rpb24gKGJ1ZmZlciwgb2Zmc2V0LCBpc0xFLCBtTGVuLCBuQnl0ZXMpIHtcbiAgdmFyIGUsIG1cbiAgdmFyIGVMZW4gPSBuQnl0ZXMgKiA4IC0gbUxlbiAtIDFcbiAgdmFyIGVNYXggPSAoMSA8PCBlTGVuKSAtIDFcbiAgdmFyIGVCaWFzID0gZU1heCA+PiAxXG4gIHZhciBuQml0cyA9IC03XG4gIHZhciBpID0gaXNMRSA/IChuQnl0ZXMgLSAxKSA6IDBcbiAgdmFyIGQgPSBpc0xFID8gLTEgOiAxXG4gIHZhciBzID0gYnVmZmVyW29mZnNldCArIGldXG5cbiAgaSArPSBkXG5cbiAgZSA9IHMgJiAoKDEgPDwgKC1uQml0cykpIC0gMSlcbiAgcyA+Pj0gKC1uQml0cylcbiAgbkJpdHMgKz0gZUxlblxuICBmb3IgKDsgbkJpdHMgPiAwOyBlID0gZSAqIDI1NiArIGJ1ZmZlcltvZmZzZXQgKyBpXSwgaSArPSBkLCBuQml0cyAtPSA4KSB7fVxuXG4gIG0gPSBlICYgKCgxIDw8ICgtbkJpdHMpKSAtIDEpXG4gIGUgPj49ICgtbkJpdHMpXG4gIG5CaXRzICs9IG1MZW5cbiAgZm9yICg7IG5CaXRzID4gMDsgbSA9IG0gKiAyNTYgKyBidWZmZXJbb2Zmc2V0ICsgaV0sIGkgKz0gZCwgbkJpdHMgLT0gOCkge31cblxuICBpZiAoZSA9PT0gMCkge1xuICAgIGUgPSAxIC0gZUJpYXNcbiAgfSBlbHNlIGlmIChlID09PSBlTWF4KSB7XG4gICAgcmV0dXJuIG0gPyBOYU4gOiAoKHMgPyAtMSA6IDEpICogSW5maW5pdHkpXG4gIH0gZWxzZSB7XG4gICAgbSA9IG0gKyBNYXRoLnBvdygyLCBtTGVuKVxuICAgIGUgPSBlIC0gZUJpYXNcbiAgfVxuICByZXR1cm4gKHMgPyAtMSA6IDEpICogbSAqIE1hdGgucG93KDIsIGUgLSBtTGVuKVxufVxuXG5leHBvcnRzLndyaXRlID0gZnVuY3Rpb24gKGJ1ZmZlciwgdmFsdWUsIG9mZnNldCwgaXNMRSwgbUxlbiwgbkJ5dGVzKSB7XG4gIHZhciBlLCBtLCBjXG4gIHZhciBlTGVuID0gbkJ5dGVzICogOCAtIG1MZW4gLSAxXG4gIHZhciBlTWF4ID0gKDEgPDwgZUxlbikgLSAxXG4gIHZhciBlQmlhcyA9IGVNYXggPj4gMVxuICB2YXIgcnQgPSAobUxlbiA9PT0gMjMgPyBNYXRoLnBvdygyLCAtMjQpIC0gTWF0aC5wb3coMiwgLTc3KSA6IDApXG4gIHZhciBpID0gaXNMRSA/IDAgOiAobkJ5dGVzIC0gMSlcbiAgdmFyIGQgPSBpc0xFID8gMSA6IC0xXG4gIHZhciBzID0gdmFsdWUgPCAwIHx8ICh2YWx1ZSA9PT0gMCAmJiAxIC8gdmFsdWUgPCAwKSA/IDEgOiAwXG5cbiAgdmFsdWUgPSBNYXRoLmFicyh2YWx1ZSlcblxuICBpZiAoaXNOYU4odmFsdWUpIHx8IHZhbHVlID09PSBJbmZpbml0eSkge1xuICAgIG0gPSBpc05hTih2YWx1ZSkgPyAxIDogMFxuICAgIGUgPSBlTWF4XG4gIH0gZWxzZSB7XG4gICAgZSA9IE1hdGguZmxvb3IoTWF0aC5sb2codmFsdWUpIC8gTWF0aC5MTjIpXG4gICAgaWYgKHZhbHVlICogKGMgPSBNYXRoLnBvdygyLCAtZSkpIDwgMSkge1xuICAgICAgZS0tXG4gICAgICBjICo9IDJcbiAgICB9XG4gICAgaWYgKGUgKyBlQmlhcyA+PSAxKSB7XG4gICAgICB2YWx1ZSArPSBydCAvIGNcbiAgICB9IGVsc2Uge1xuICAgICAgdmFsdWUgKz0gcnQgKiBNYXRoLnBvdygyLCAxIC0gZUJpYXMpXG4gICAgfVxuICAgIGlmICh2YWx1ZSAqIGMgPj0gMikge1xuICAgICAgZSsrXG4gICAgICBjIC89IDJcbiAgICB9XG5cbiAgICBpZiAoZSArIGVCaWFzID49IGVNYXgpIHtcbiAgICAgIG0gPSAwXG4gICAgICBlID0gZU1heFxuICAgIH0gZWxzZSBpZiAoZSArIGVCaWFzID49IDEpIHtcbiAgICAgIG0gPSAodmFsdWUgKiBjIC0gMSkgKiBNYXRoLnBvdygyLCBtTGVuKVxuICAgICAgZSA9IGUgKyBlQmlhc1xuICAgIH0gZWxzZSB7XG4gICAgICBtID0gdmFsdWUgKiBNYXRoLnBvdygyLCBlQmlhcyAtIDEpICogTWF0aC5wb3coMiwgbUxlbilcbiAgICAgIGUgPSAwXG4gICAgfVxuICB9XG5cbiAgZm9yICg7IG1MZW4gPj0gODsgYnVmZmVyW29mZnNldCArIGldID0gbSAmIDB4ZmYsIGkgKz0gZCwgbSAvPSAyNTYsIG1MZW4gLT0gOCkge31cblxuICBlID0gKGUgPDwgbUxlbikgfCBtXG4gIGVMZW4gKz0gbUxlblxuICBmb3IgKDsgZUxlbiA+IDA7IGJ1ZmZlcltvZmZzZXQgKyBpXSA9IGUgJiAweGZmLCBpICs9IGQsIGUgLz0gMjU2LCBlTGVuIC09IDgpIHt9XG5cbiAgYnVmZmVyW29mZnNldCArIGkgLSBkXSB8PSBzICogMTI4XG59XG4iLCJcbi8qKlxuICogaXNBcnJheVxuICovXG5cbnZhciBpc0FycmF5ID0gQXJyYXkuaXNBcnJheTtcblxuLyoqXG4gKiB0b1N0cmluZ1xuICovXG5cbnZhciBzdHIgPSBPYmplY3QucHJvdG90eXBlLnRvU3RyaW5nO1xuXG4vKipcbiAqIFdoZXRoZXIgb3Igbm90IHRoZSBnaXZlbiBgdmFsYFxuICogaXMgYW4gYXJyYXkuXG4gKlxuICogZXhhbXBsZTpcbiAqXG4gKiAgICAgICAgaXNBcnJheShbXSk7XG4gKiAgICAgICAgLy8gPiB0cnVlXG4gKiAgICAgICAgaXNBcnJheShhcmd1bWVudHMpO1xuICogICAgICAgIC8vID4gZmFsc2VcbiAqICAgICAgICBpc0FycmF5KCcnKTtcbiAqICAgICAgICAvLyA+IGZhbHNlXG4gKlxuICogQHBhcmFtIHttaXhlZH0gdmFsXG4gKiBAcmV0dXJuIHtib29sfVxuICovXG5cbm1vZHVsZS5leHBvcnRzID0gaXNBcnJheSB8fCBmdW5jdGlvbiAodmFsKSB7XG4gIHJldHVybiAhISB2YWwgJiYgJ1tvYmplY3QgQXJyYXldJyA9PSBzdHIuY2FsbCh2YWwpO1xufTtcbiIsIi8vIHNoaW0gZm9yIHVzaW5nIHByb2Nlc3MgaW4gYnJvd3NlclxuXG52YXIgcHJvY2VzcyA9IG1vZHVsZS5leHBvcnRzID0ge307XG52YXIgcXVldWUgPSBbXTtcbnZhciBkcmFpbmluZyA9IGZhbHNlO1xudmFyIGN1cnJlbnRRdWV1ZTtcbnZhciBxdWV1ZUluZGV4ID0gLTE7XG5cbmZ1bmN0aW9uIGNsZWFuVXBOZXh0VGljaygpIHtcbiAgICBkcmFpbmluZyA9IGZhbHNlO1xuICAgIGlmIChjdXJyZW50UXVldWUubGVuZ3RoKSB7XG4gICAgICAgIHF1ZXVlID0gY3VycmVudFF1ZXVlLmNvbmNhdChxdWV1ZSk7XG4gICAgfSBlbHNlIHtcbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgIH1cbiAgICBpZiAocXVldWUubGVuZ3RoKSB7XG4gICAgICAgIGRyYWluUXVldWUoKTtcbiAgICB9XG59XG5cbmZ1bmN0aW9uIGRyYWluUXVldWUoKSB7XG4gICAgaWYgKGRyYWluaW5nKSB7XG4gICAgICAgIHJldHVybjtcbiAgICB9XG4gICAgdmFyIHRpbWVvdXQgPSBzZXRUaW1lb3V0KGNsZWFuVXBOZXh0VGljayk7XG4gICAgZHJhaW5pbmcgPSB0cnVlO1xuXG4gICAgdmFyIGxlbiA9IHF1ZXVlLmxlbmd0aDtcbiAgICB3aGlsZShsZW4pIHtcbiAgICAgICAgY3VycmVudFF1ZXVlID0gcXVldWU7XG4gICAgICAgIHF1ZXVlID0gW107XG4gICAgICAgIHdoaWxlICgrK3F1ZXVlSW5kZXggPCBsZW4pIHtcbiAgICAgICAgICAgIGlmIChjdXJyZW50UXVldWUpIHtcbiAgICAgICAgICAgICAgICBjdXJyZW50UXVldWVbcXVldWVJbmRleF0ucnVuKCk7XG4gICAgICAgICAgICB9XG4gICAgICAgIH1cbiAgICAgICAgcXVldWVJbmRleCA9IC0xO1xuICAgICAgICBsZW4gPSBxdWV1ZS5sZW5ndGg7XG4gICAgfVxuICAgIGN1cnJlbnRRdWV1ZSA9IG51bGw7XG4gICAgZHJhaW5pbmcgPSBmYWxzZTtcbiAgICBjbGVhclRpbWVvdXQodGltZW91dCk7XG59XG5cbnByb2Nlc3MubmV4dFRpY2sgPSBmdW5jdGlvbiAoZnVuKSB7XG4gICAgdmFyIGFyZ3MgPSBuZXcgQXJyYXkoYXJndW1lbnRzLmxlbmd0aCAtIDEpO1xuICAgIGlmIChhcmd1bWVudHMubGVuZ3RoID4gMSkge1xuICAgICAgICBmb3IgKHZhciBpID0gMTsgaSA8IGFyZ3VtZW50cy5sZW5ndGg7IGkrKykge1xuICAgICAgICAgICAgYXJnc1tpIC0gMV0gPSBhcmd1bWVudHNbaV07XG4gICAgICAgIH1cbiAgICB9XG4gICAgcXVldWUucHVzaChuZXcgSXRlbShmdW4sIGFyZ3MpKTtcbiAgICBpZiAocXVldWUubGVuZ3RoID09PSAxICYmICFkcmFpbmluZykge1xuICAgICAgICBzZXRUaW1lb3V0KGRyYWluUXVldWUsIDApO1xuICAgIH1cbn07XG5cbi8vIHY4IGxpa2VzIHByZWRpY3RpYmxlIG9iamVjdHNcbmZ1bmN0aW9uIEl0ZW0oZnVuLCBhcnJheSkge1xuICAgIHRoaXMuZnVuID0gZnVuO1xuICAgIHRoaXMuYXJyYXkgPSBhcnJheTtcbn1cbkl0ZW0ucHJvdG90eXBlLnJ1biA9IGZ1bmN0aW9uICgpIHtcbiAgICB0aGlzLmZ1bi5hcHBseShudWxsLCB0aGlzLmFycmF5KTtcbn07XG5wcm9jZXNzLnRpdGxlID0gJ2Jyb3dzZXInO1xucHJvY2Vzcy5icm93c2VyID0gdHJ1ZTtcbnByb2Nlc3MuZW52ID0ge307XG5wcm9jZXNzLmFyZ3YgPSBbXTtcbnByb2Nlc3MudmVyc2lvbiA9ICcnOyAvLyBlbXB0eSBzdHJpbmcgdG8gYXZvaWQgcmVnZXhwIGlzc3Vlc1xucHJvY2Vzcy52ZXJzaW9ucyA9IHt9O1xuXG5mdW5jdGlvbiBub29wKCkge31cblxucHJvY2Vzcy5vbiA9IG5vb3A7XG5wcm9jZXNzLmFkZExpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3Mub25jZSA9IG5vb3A7XG5wcm9jZXNzLm9mZiA9IG5vb3A7XG5wcm9jZXNzLnJlbW92ZUxpc3RlbmVyID0gbm9vcDtcbnByb2Nlc3MucmVtb3ZlQWxsTGlzdGVuZXJzID0gbm9vcDtcbnByb2Nlc3MuZW1pdCA9IG5vb3A7XG5cbnByb2Nlc3MuYmluZGluZyA9IGZ1bmN0aW9uIChuYW1lKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmJpbmRpbmcgaXMgbm90IHN1cHBvcnRlZCcpO1xufTtcblxucHJvY2Vzcy5jd2QgPSBmdW5jdGlvbiAoKSB7IHJldHVybiAnLycgfTtcbnByb2Nlc3MuY2hkaXIgPSBmdW5jdGlvbiAoZGlyKSB7XG4gICAgdGhyb3cgbmV3IEVycm9yKCdwcm9jZXNzLmNoZGlyIGlzIG5vdCBzdXBwb3J0ZWQnKTtcbn07XG5wcm9jZXNzLnVtYXNrID0gZnVuY3Rpb24oKSB7IHJldHVybiAwOyB9O1xuIl19
