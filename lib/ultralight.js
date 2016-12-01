'use strict';

/**
  @author Ezequiel Santamaría Navarro
  @brief Utilidad para serializar ultralight.
*/

var maxdeep = 100;
/*
function split(s) {
  var arr = s.split('|');
  for (var i = 0; i < arr.length - 1; i++) {
    if (arr[i].endsWith('\\')) {
      arr[i] = arr[i].substring(0, arr[i].length-1) + '|' + arr[i+1];
      arr.splice(i+1, 1);
      i--;
    }
  }
  for (var i = 0; i < arr.length; i++) {
    arr[i] = arr[i].replace('\\\\','\\');
  }
  return arr;
}

function rjoin(arr) {
  var r = "";
  for (var i = 0; i < arr.length; i++) {
    if (typeof arr[i] === "string")
      r += arr[i]
    else
      r += rJoin(arr[i]);
  }
  return r;
}
*/
module.exports = {
  parse: function(s, separator) {
    separator = separator || '|';
    var arr = s.split(separator);
    var obj = {};
    if (arr.length&1) {
      throw 'Odd number of ultralight elements; it must be even';
    }
    for (var i = 0; i < arr.length; i+=2) {
      obj[arr[i]] = arr[i+1];
    }
    return obj;
  },
  stringify: function(obj, separator) {
    separator = separator || '|';
    var ul = [];
    for (var k in obj) {
      if (typeof obj[k] === 'number' || typeof obj[k] === 'string') {
        ul.push(k + separator + obj[k]);
      } else {
        throw 'Ultralight can only serialize strings and numbers, '+(typeof obj[k])+' found';
      }
    }
    return ul.join(separator);
  }
}
