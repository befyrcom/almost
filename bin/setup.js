#!/usr/bin/env node
'use strict';

/**
 * `almost-setup` is kept as an alias so the original install command still
 * works. It delegates to `almost init` rather than carrying a second copy of
 * the install logic that could drift.
 */
process.argv = [process.argv[0], process.argv[1], 'init'];
require('./almost.js');
