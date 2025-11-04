#!/usr/bin/env perl
use strict;
use warnings;

# one_file_t_extract.pl
# Extract occurrences of t('key') or t("key") from a given file and print
# lines in the form: filepath:line_number:key

my $file = shift or die "Usage: $0 <file>\n";
open my $fh, '<', $file or die "Can't open $file: $!\n";
my $ln = 0;
while (<$fh>) {
    $ln++;
    # match t(   'key'   ) or t(  "key"  , ... )
    while (/(?:\b|\W)t\(\s*(['"])((?:\\.|(?!\1).)*)\1/sg) {
        my $key = $2;
        # unescape basic escapes for readability
        $key =~ s/\\(['"\\])/$1/g;
        print "$file:$ln:$key\n";
    }
}

close $fh;
exit 0;
