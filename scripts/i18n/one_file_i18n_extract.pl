#!/usr/bin/env perl
use strict;
use warnings;
use utf8;
binmode STDOUT, ':encoding(UTF-8)';

my $file = shift or die "Usage: $0 file\n";
open my $fh, '<:encoding(UTF-8)', $file or die "Can't open $file: $!";
local $/ = undef;
my $text = <$fh>;
close $fh;

# Helper: get 1-based line number for a byte position
sub lineno_for_pos {
  my ($txt, $pos) = @_;
  my $lines = () = substr($txt, 0, $pos) =~ /\n/g;
  return $lines + 1;
}

# normalize and filter candidate
sub clean_and_filter {
  my ($s) = @_;
  return undef unless defined $s;
  $s =~ s/^\s+|\s+$//g;
  $s =~ s/\s+/ /g;
  # skip if contains JSX expression or comment markers or HTML tags or code-looking tokens
  return undef if $s =~ /[{}`<>]/;
  return undef if $s =~ /\b(?:function|const|let|var|=>|class|import|export)\b/;
  # skip very long matches (likely code blocks)
  return undef if length($s) > 240;
  # skip if tiny or only punctuation
  return undef if $s =~ /^\W+$/;
  return $s;
}

# 1) Find JSX text nodes: >...< containing Japanese, but avoid matching JSX expressions
# Disallow '{' inside match so JSX comments/expressions are skipped.
while ($text =~ />((?:[^<{]|\n)*?[一-龠ぁ-ゔァ-ヴー々〆〤](?:[^<{]|\n)*?)</g) {
  my $match = $1;
  # compute line number (position of match start relative to whole text)
  my $pos = pos($text) - length($match) - 1; # position of '>'
  my $line = lineno_for_pos($text, $pos);
  my $clean = clean_and_filter($match);
  print "$file:$line:$clean\n" if defined $clean and length($clean) > 0;
}

# 2) Capture specific JSX/HTML attributes only (visible UI attributes)
#    e.g. title, alt, placeholder, aria-*
while ($text =~ /\b(title|alt|placeholder|aria-[A-Za-z0-9_-]+|aria[A-Z][A-Za-z0-9_]*)\s*=\s*("((?:[^"\\]|\\.)*?[一-龠ぁ-ゔァ-ヴー々〆〤](?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*?[一-龠ぁ-ゔァ-ヴー々〆〤](?:[^'\\]|\\.)*)')/g) {
  my $attr = $1;
  my $value = defined $3 ? $3 : $4;
  my $pos = pos($text) - length($value) - 1;
  my $line = lineno_for_pos($text, $pos);
  # unescape basic escapes for readability
  $value =~ s/\\n/\n/g;
  $value =~ s/\\"/"/g;
  $value =~ s/\\'/'/g;
  my $clean = clean_and_filter($value);
  print "$file:$line:$clean\n" if defined $clean and length($clean) > 0;
}

# Note: intentionally skipping generic string and template literal captures to reduce noise.
