import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { maskPhone, normaliseBdPhone } from '../src/bd/phone.js';
import { DISTRICTS, DIVISIONS, districtsOf, findDistrict, getDistrict } from '../src/bd/districts.js';
import { formatTaka } from '../src/bd/money.js';
import { toAsciiDigits, toBanglaDigits } from '../src/bd/digits.js';

describe('BD phone numbers', () => {
  const ok = [
    ['01712345678', '01712345678', 'Grameenphone'],
    ['1712345678', '01712345678', 'Grameenphone'],
    ['+8801712345678', '01712345678', 'Grameenphone'],
    ['8801912345678', '01912345678', 'Banglalink'],
    ['008801512345678', '01512345678', 'Teletalk'],
    ['+880 1612-345678', '01612345678', 'Airtel'],
    ['(+880) 18 1234 5678', '01812345678', 'Robi'],
    ['০১৩১২৩৪৫৬৭৮', '01312345678', 'Grameenphone'],
    ['014.1234.5678', '01412345678', 'Banglalink'],
  ] as const;
  for (const [input, local, operator] of ok) {
    test(`accepts ${input}`, () => {
      const p = normaliseBdPhone(input);
      assert.ok(p, input);
      assert.equal(p.local, local);
      assert.equal(p.e164, `+88${local}`);
      assert.equal(p.operator, operator);
    });
  }

  test('rejects invalid numbers', () => {
    for (const bad of ['', '0171234567', '017123456789', '01212345678', '01112345678', '02-9123456', 'call me', '+1 415 555 0100', '01712a45678', '+880-1712-345678-9']) {
      assert.equal(normaliseBdPhone(bad), null, bad);
    }
    assert.equal(normaliseBdPhone(undefined as unknown as string), null);
  });

  test('maskPhone', () => {
    assert.equal(maskPhone('01712345678'), '017****5678');
    assert.equal(maskPhone('123'), '***');
  });
});

describe('districts', () => {
  test('8 divisions, 64 districts, unique ids, every district in a division', () => {
    assert.equal(DIVISIONS.length, 8);
    assert.equal(DISTRICTS.length, 64);
    assert.equal(new Set(DISTRICTS.map((d) => d.id)).size, 64);
    const counts = Object.fromEntries(DIVISIONS.map((d) => [d.id, districtsOf(d.id).length]));
    assert.deepEqual(counts, { barishal: 6, chattogram: 11, dhaka: 13, khulna: 10, mymensingh: 4, rajshahi: 8, rangpur: 8, sylhet: 4 });
    for (const d of DISTRICTS) assert.match(d.bn, /[ঀ-৿]/);
    for (const d of DISTRICTS) assert.match(d.id, /^[a-z]+$/, 'ids are callback-safe');
  });

  test('findDistrict by English, Bangla, alias and suffix', () => {
    assert.equal(findDistrict('Dhaka')?.id, 'dhaka');
    assert.equal(findDistrict('  dhaka district ')?.id, 'dhaka');
    assert.equal(findDistrict('ঢাকা')?.id, 'dhaka');
    assert.equal(findDistrict('কক্সবাজার')?.id, 'coxsbazar');
    assert.equal(findDistrict("Cox's Bazar")?.id, 'coxsbazar');
    assert.equal(findDistrict('Chittagong')?.id, 'chattogram');
    assert.equal(findDistrict('Comilla')?.id, 'cumilla');
    assert.equal(findDistrict('Bogra')?.id, 'bogura');
    assert.equal(findDistrict('Jessore')?.id, 'jashore');
    assert.equal(findDistrict('Chapai Nawabganj')?.id, 'chapainawabganj');
    assert.equal(findDistrict('বগুড়া জেলা')?.id, 'bogura');
    assert.equal(findDistrict('Narnia'), undefined);
    assert.equal(findDistrict(''), undefined);
    assert.equal(getDistrict('nope'), undefined);
  });
});

describe('money and digits', () => {
  test('formatTaka uses South Asian grouping', () => {
    assert.equal(formatTaka(0), '৳0');
    assert.equal(formatTaka(950), '৳950');
    assert.equal(formatTaka(1850), '৳1,850');
    assert.equal(formatTaka(123456), '৳1,23,456');
    assert.equal(formatTaka(12345678), '৳1,23,45,678');
    assert.equal(formatTaka(99.5), '৳99.50');
    assert.equal(formatTaka(-1500), '-৳1,500');
    assert.equal(formatTaka(123456, 'bn'), '৳১,২৩,৪৫৬');
    assert.throws(() => formatTaka(Number.NaN), RangeError);
  });

  test('digit conversion', () => {
    assert.equal(toAsciiDigits('০১৭১২'), '01712');
    assert.equal(toBanglaDigits('2026-11-15'), '২০২৬-১১-১৫');
    assert.equal(toAsciiDigits(toBanglaDigits('0123456789')), '0123456789');
  });
});
